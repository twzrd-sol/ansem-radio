import { useState } from "react";

import type { ActivityInput } from "../data/api";
import { seasonPhase } from "../data/season";
import type { Action, CurrentSeason, HubSnapshot } from "../data/types";
import { fmt, utc } from "../lib/format";
import { EmptyBlock, ErrorBlock, Icon, type IconName, PageHead, SampleTag, Skeleton } from "../ui/atoms";
import { OpeningTime, SeasonOpening } from "../ui/SeasonOpening";

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
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const points = season ? season.policy.weights[a.action] : null;
  const capped = season?.me ? season.me.today >= season.policy.dailyCap : false;
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
        <p className="poll__q" id="poll-q">
          {poll.question}
        </p>
        <div className="choices" role="radiogroup" aria-labelledby="poll-q">
          {poll.options.map((option, i) => (
            <button key={option} className="choice" type="button" role="radio" aria-checked={choice === i} onClick={() => setChoice(i)}>
              <span className="choice__dot" aria-hidden="true" />
              {option}
            </button>
          ))}
        </div>
        <button className="btn btn--primary btn--block" type="button" disabled={choice === null || busy} onClick={() => choice !== null && void send({ action: "poll_response", pollId: poll.id, choice }, capped ? "Answer counted; today's cap is reached" : `+${points} points`)}>
          {busy ? "Sending…" : "Lock in answer"}
        </button>
      </div>
    );
  } else if (a.id === "question") {
    body = done.question
      ? finished("Question sent. The streamer picks which ones to answer.")
      : <TextActivity id="q" label="Your question" placeholder="Ask the guest or the room…" button="Send question" onSend={(text) => send({ action: "question", text }, capped ? "Question sent; today's cap is reached" : `+${points} points`)} />;
  } else {
    body = done[a.id]
      ? finished(`Sent. Waiting for the streamer to accept it; +${points} when they do.`)
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
      {body}
    </article>
  );
}

/** What the fan already did this season, from the hub's records (one of each kind in P0). */
function doneFrom(season: CurrentSeason | null): Done {
  const sent = new Set(season?.me?.submissions.map((s) => s.action) ?? []);
  return { poll: sent.has("poll_response"), question: sent.has("question"), prompt: false, clip: sent.has("accepted_work") };
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
  const done = { ...doneFrom(season), ...doneHere };
  const markDone = (id: ActivityDef["id"]) => setDoneHere((d) => ({ ...d, [id]: true }));
  const send: Submit = submit ?? (async () => {});
  const head = (
    <PageHead
      eyebrow={season ? `Season ${season.number} · Radio LAN` : "Radio LAN"}
      title="Play"
      lede="Each activity has a published point value. Points are capped per day and per season, across all activities; the daily cap resets at 00:00 UTC. Everything happens on this site; nothing from Twitch chat counts."
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
      </>
    );
  }
  const phase = seasonPhase(season, now);
  const open = phase === "open";
  const me = season.me;
  return (
    <>
      {head}
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
      {joined && me && (
        <p className="act__caps" style={{ marginBottom: 12 }}>
          <span>
            Today: {fmt(me.today)} of {fmt(season.policy.dailyCap)} points · season: {fmt(me.points)} of {fmt(season.policy.weeklyCap)}
          </span>
        </p>
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
      {snapshot.scenario === "sample" && (
        <p className="small fine">
          <SampleTag />
          Point values and caps here are sample rules. Each season publishes its own before it opens.
        </p>
      )}
    </>
  );
}
