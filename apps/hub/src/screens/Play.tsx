import { useState } from "react";

import type { ActivityInput } from "../data/api";
import { creatorCircles } from "../data/circle";
import { pointsSeasonEyebrow, seasonPhase } from "../data/season";
import type { Action, CurrentSeason, HubSnapshot } from "../data/types";
import { fmt, utc } from "../lib/format";
import { EmptyBlock, ErrorBlock, Icon, type IconName, PageHead, SampleTag, Skeleton } from "../ui/atoms";
import { SuperfansPeek } from "../ui/Competition";
import { nextBadge, SeasonStanding } from "../ui/Collector";
import { OpeningTime, SeasonOpening } from "../ui/SeasonOpening";
import "../styles/presentation.css";

export interface ActivityDef {
  id: "poll" | "question" | "prompt" | "clip";
  action: Action;
  title: string;
  icon: IconName;
  blurb: string;
}

/** Native arena activities only (#47: question, poll_response, accepted_work). Nothing from Twitch counts. */
export const ACTIVITIES: readonly ActivityDef[] = [
  { id: "poll", action: "poll_response", title: "Live poll", icon: "poll", blurb: "The streamer posts a poll during the show. Pick an answer." },
  { id: "question", action: "question", title: "Ask a question", icon: "question", blurb: "Ask the guest or the room. The streamer picks which ones to answer on stream." },
  { id: "prompt", action: "accepted_work", title: "Answer the prompt", icon: "mic", blurb: "Reply to the streamer's published prompt. It counts once the streamer accepts it." },
  { id: "clip", action: "accepted_work", title: "Clip or note", icon: "film", blurb: "Send a moment from the show or a short note, your own work only. It counts once the streamer accepts and co-signs it." },
];

/** Sends one activity to the hub; resolves when it is recorded, rejects with the hub's reason. */
export type Submit = (input: ActivityInput) => Promise<void>;

type Done = Record<ActivityDef["id"], boolean>;

function TextActivity({ id, label, placeholder, button, onSend }: { id: string; label: string; placeholder: string; button: string; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await onSend(text.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="field">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <textarea id={id} maxLength={280} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="field__row">
        <span className="small">{text.length}/280</span>
        <button className="btn btn--primary" type="button" disabled={!text.trim() || busy} onClick={() => void send()}>
          {busy ? "Sending…" : button}
        </button>
      </div>
    </div>
  );
}

function ActivityCard({ a, season, open, now, joined, done, markDone, submit, toast }: {
  a: ActivityDef;
  season: CurrentSeason | null;
  open: boolean;
  now: number;
  joined: boolean;
  done: Done;
  markDone: (id: ActivityDef["id"]) => void;
  submit: Submit;
  toast: (text: string) => void;
}) {
  const [choice, setChoice] = useState<{ pollId: string; index: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const points = season ? a.id === "poll" && season.poll?.placeholder ? 0 : season.policy.weights[a.action] : null;
  const badge = season?.me ? nextBadge(season.me) : "First play";
  const capped = season?.me ? season.me.today >= season.policy.dailyCap || season.me.points >= season.policy.weeklyCap : false;
  const locked = !season || !joined || !open;
  const send = async (input: ActivityInput, onOk: string) => {
    setBusy(true);
    try {
      await submit(input);
      markDone(a.id);
      toast(onOk);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't send it.");
    } finally {
      setBusy(false);
    }
  };
  const finished = (text: string) => (
    <p className="act__done">
      <Icon name="check" size="sm" />
      {text}
    </p>
  );
  const waiting = (text: string) => (
    <p className="act__locked">
      <Icon name="clock" size="sm" />
      {text}
    </p>
  );

  let body;
  if (!season || points === null) body = <p className="act__locked"><Icon name="lock" size="sm" />Starts when the first season opens</p>;
  else if (seasonPhase(season, now) === "upcoming") body = <p className="act__locked"><Icon name="clock" size="sm" /><OpeningTime at={season.opensAt} /></p>;
  else if (!open) body = <p className="act__locked"><Icon name="lock" size="sm" />This season's points are frozen</p>;
  else if (!joined) body = <p className="act__locked"><Icon name="lock" size="sm" />Join the season to play</p>;
  else if (a.id === "poll") {
    const poll = season.poll;
    body = done.poll ? (
      finished(`Answer counted. The next poll opens when the streamer posts one.`)
    ) : !poll ? (
      waiting("No poll is open right now. The streamer posts one during the show.")
    ) : (
      <div>
        {poll.placeholder && <p className="small">Placeholder poll for preview. Answers here do not earn points.</p>}
        <p className="poll__q" id="poll-q">
          {poll.question}
        </p>
        <div className="choices" role="radiogroup" aria-labelledby="poll-q">
          {poll.options.map((option, i) => (
            <button key={option} className="choice" type="button" role="radio" aria-checked={choice?.pollId === poll.id && choice.index === i} onClick={() => setChoice({ pollId: poll.id, index: i })}>
              <span className="choice__dot" aria-hidden="true" />
              {option}
            </button>
          ))}
        </div>
        <button className="btn btn--primary btn--block" type="button" disabled={poll.placeholder || choice?.pollId !== poll.id || busy} onClick={() => choice?.pollId === poll.id && void send({ action: "poll_response", pollId: poll.id, choice: choice.index }, capped ? "Answer counted; today's cap is reached" : "Recorded. Your standing shows the credited points.")}>
          {busy ? "Sending…" : poll.placeholder ? "Preview only" : "Lock in answer"}
        </button>
      </div>
    );
  } else if (a.id === "question") {
    body = done.question
      ? finished("Question sent. The streamer picks which ones to answer.")
      : <TextActivity id="q" label="Your question" placeholder="Ask the guest or the room…" button="Send question" onSend={(text) => send({ action: "question", text }, capped ? "Question sent; today's cap is reached" : "Recorded. Your standing shows the credited points.")} />;
  } else {
    body = done[a.id]
      ? finished(`Sent. Waiting for the streamer to accept it; up to +${points} within the published caps.`)
      : a.id === "prompt" && !season.prompt
        ? waiting("No prompt is published right now.")
        : (
          <div className="field">
            {a.id === "prompt" && <p className="quote">{season.prompt}</p>}
            <TextActivity id={`${a.id}-text`} label={a.title} placeholder={a.id === "prompt" ? "Your answer…" : "Paste a link or write a short note…"} button="Send for review" onSend={(text) => send({ action: "accepted_work", text }, "Sent for review")} />
          </div>
        );
  }

  return (
    <article className={locked ? "act act--locked" : "act"} aria-labelledby={`h-${a.id}`}>
      <div className="act__head">
        <span className="act__icon">
          <Icon name={a.icon} />
        </span>
        <div className="act__title">
          <h2 className="h3" id={`h-${a.id}`}>
            {a.title}
          </h2>
          <p className="small">{a.blurb}</p>
        </div>
        {points !== null && (
          <span className="act__pts" aria-label={`${points} points`}>
            +{points}
          </span>
        )}
      </div>
      {badge && !(a.id === "poll" && season?.poll?.placeholder) && <p className="small act__badge"><Icon name="star" size="sm" /> Can light: {badge}{a.action === "accepted_work" ? " · after acceptance" : " · after credit"}</p>}
      {body}
    </article>
  );
}

/** What the fan already did this season, from the hub's records (daily question/work cards and the current poll). */
export function doneFrom(season: CurrentSeason | null, now: number): Done {
  const submissions = season?.me?.submissions ?? [];
  const today = (at?: number) => at === undefined || Math.floor(at / 86_400_000) === Math.floor(now / 86_400_000);
  return {
    poll: Boolean(season?.poll && submissions.some((s) => s.action === "poll_response" && s.pollId === season.poll?.id)),
    question: submissions.some((s) => s.action === "question" && today(s.occurredAt)),
    prompt: false,
    clip: submissions.some((s) => s.action === "accepted_work" && today(s.occurredAt)),
  };
}

export function Play({ snapshot, load, now, joined, onJoin, onRetry, toast, submit, nextSeasonAt = null }: {
  snapshot: HubSnapshot | null;
  load: "loading" | "error" | "ready";
  now: number;
  joined: boolean;
  onJoin: () => void;
  onRetry: () => void;
  toast: (text: string) => void;
  /** Absent in a design preview: a send then only marks the card. */
  submit?: Submit;
  /** When Radio LAN's arena starts its next on-chain season (ms), if its schedule is known. */
  nextSeasonAt?: number | null;
}) {
  const season = snapshot?.season ?? null;
  const [doneHere, setDoneHere] = useState<Partial<Done>>({});
  const [donePollId, setDonePollId] = useState<string | null>(null);
  const serverDone = doneFrom(season, now);
  const done = { ...serverDone, ...doneHere };
  if (doneHere.poll) done.poll = donePollId === season?.poll?.id;
  const markDone = (id: ActivityDef["id"]) => {
    setDoneHere((d) => ({ ...d, [id]: true }));
    if (id === "poll") setDonePollId(season?.poll?.id ?? null);
  };
  const send: Submit = submit ?? (async () => {});
  const head = (
    <PageHead
      eyebrow={season ? pointsSeasonEyebrow(season) : "Radio LAN"}
      title="Play"
      lede="This season is the game you are inside. Today's points sit against the published cap. The next action can light a collected mark."
    />
  );
  if (load === "loading") return <>{head}<div className="acts"><Skeleton kinds={["card"]} /><Skeleton kinds={["card"]} /><Skeleton kinds={["card"]} /><Skeleton kinds={["card"]} /></div></>;
  if (load === "error" || !snapshot) return <>{head}<ErrorBlock text="Activities didn't load. Points you already have are safe." onRetry={onRetry} /></>;
  if (!season) {
    return (
      <>
        {head}
        <EmptyBlock icon="lock" title="No season is open yet" text={nextSeasonAt ? `Radio LAN's next on-chain season starts ${utc(nextSeasonAt)}. Activities start when the first points season is published for it, with its point values and caps; playing stays free.` : "Activities on this site start with the first season. Point values and caps are published before it opens, and playing stays free."} />
        <div className="acts" style={{ marginTop: 16 }}>
          {ACTIVITIES.map((a) => (
            <ActivityCard key={a.id} a={a} season={null} open={false} now={now} joined={false} done={done} markDone={markDone} submit={send} toast={toast} />
          ))}
        </div>
        <p className="small fine">
          <a href="#/circle">Meet superfans</a> of the same season. Real Discord or X membership can unlock season-points eligibility. Fake joins are refused. <a href="#/communities">Communities</a>
        </p>
      </>
    );
  }
  const phase = seasonPhase(season, now);
  const open = phase === "open";
  return (
    <>
      {head}
      <ChallengeBrief season={season} sample={snapshot.scenario === "sample"} />
      <p className="small" style={{ marginTop: -12, marginBottom: 16 }}>
        Each activity has a published point value. Points are capped per day and per season, across all activities; the daily cap resets at 00:00 UTC. Everything happens on this site; nothing from Twitch chat counts.
      </p>
      <SeasonStanding snapshot={snapshot} now={now} />
      {phase === "upcoming" && <SeasonOpening season={season} now={now} />}
      {!joined && open && (
        <div className="join">
          <div>
            <p className="h3">Join this season</p>
            <p className="small">Free. No wallet. Points start at 0 every season.</p>
          </div>
          <button className="btn btn--primary" type="button" onClick={onJoin}>
            Join free
          </button>
        </div>
      )}
      {phase === "closed" && (
        <p className="note note--warn" style={{ marginBottom: 16 }}>
          <Icon name="clock" />
          Season {season.number} points are frozen. The next opening appears when its schedule is published.
        </p>
      )}
      <div className="acts">
        {ACTIVITIES.map((a) => (
          <ActivityCard key={a.id} a={a} season={season} open={open} now={now} joined={joined} done={done} markDone={markDone} submit={send} toast={toast} />
        ))}
      </div>
      <SuperfansPeek circle={creatorCircles(snapshot, [], [])[0] ?? null} sample={snapshot.scenario === "sample"} />
      <p className="small fine">
        <a href="#/circle">Meet superfans</a> of the same season. Real Discord or X membership can unlock season-points eligibility. Fake joins are refused. <a href="#/communities">Communities</a>
      </p>
      {snapshot.scenario === "sample" && (
        <p className="small fine">
          <SampleTag />
          Fictional accounts, points and actions for preview. Each live season publishes its own rules.
        </p>
      )}
    </>
  );
}

function ChallengeBrief({ season, sample }: { season: CurrentSeason; sample: boolean }) {
  return (
    <section className="challenge-brief" aria-labelledby="h-challenge-brief">
      <div>
        <div className="challenge-brief__head">
          <p className="eyebrow">The season challenge</p>
          {sample && <SampleTag />}
        </div>
        <h2 className="h2" id="h-challenge-brief">Show up. Take part. Keep your mark.</h2>
        <p className="small" style={{ marginTop: 8 }}>Season {season.number} · {fmt(season.players)} players on the board</p>
      </div>
      <div className="challenge-brief__steps">
        <div className="challenge-step"><span className="challenge-step__num">01</span><div><p><strong>Join the room</strong></p><p className="small">Free to play; no wallet needed.</p></div></div>
        <div className="challenge-step"><span className="challenge-step__num">02</span><div><p><strong>Take part</strong></p><p className="small">Answer a posted poll, ask a question, or reply to a published prompt.</p></div></div>
        <div className="challenge-step"><span className="challenge-step__num">03</span><div><p><strong>Make something</strong></p><p className="small">Prompt replies and clips count only after the streamer accepts them. Your record stays with your profile.</p></div></div>
      </div>
    </section>
  );
}
