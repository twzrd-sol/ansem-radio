import { fmt } from "../lib/format";
import type { CreatorCircle, SeasonChallenge, StandingGap, Superfan } from "../data/circle";
import { EarnedBadges } from "./Collector";
import { Icon, SampleTag } from "./atoms";

export function ChallengeRace({ gap, featured, sample }: { gap: StandingGap; featured: SeasonChallenge | null; sample: boolean }) {
  const place = gap.joined ? (gap.rank === null ? "Unranked until your first credit" : `#${gap.rank} of ${fmt(gap.players)}`) : "Not on the board yet";
  const race = gap.behind === null
    ? gap.leaderHandle
      ? `${gap.leaderHandle} leads at ${fmt(gap.leaderPoints ?? 0)} points.`
      : "No credited points on this board yet."
    : gap.behind === 0
      ? "You lead this board."
      : `${fmt(gap.behind)} points behind ${gap.leaderHandle}.`;
  return (
    <section className="challenge-race" aria-labelledby="h-race">
      <div className="challenge-race__head">
        <h2 className="h3" id="h-race">Season standing</h2>
        {sample && <SampleTag />}
      </div>
      <p className="challenge-race__place">
        <strong>{gap.joined ? fmt(gap.points) : "—"}</strong> points · {place}
      </p>
      <p className="small">{race}</p>
      <p className="room-next">
        <span className="label">Next challenge</span>
        {gap.nextAction}
      </p>
      {featured && (
        <p className="challenge-race__featured">
          <Icon name="star" size="sm" />
          Featured path: {featured.title}
          {featured.points > 0 ? ` · +${featured.points}` : " · no points"}
        </p>
      )}
      <div className="room-standing__links">
        <a href="#/circle">Meet superfans</a>
        <a href="#/board">Points board</a>
      </div>
      <p className="small fine">Season points are not RLAN and not ICELAN. Badges are kept marks, not tokens.</p>
    </section>
  );
}

function SuperfanRow({ fan }: { fan: Superfan }) {
  const cls = ["row", fan.rank && fan.rank <= 3 && `row--${fan.rank}`, fan.me && "row--me"].filter(Boolean).join(" ");
  return (
    <li className={cls}>
      <span className="row__rank">{fan.rank ?? "—"}</span>
      <div className="row__identity">
        <span className="row__name">{fan.handle}</span>
        {fan.me && <span className="row__you">You are here</span>}
        {(fan.badges.length > 0 || fan.streakDays > 0) && (
          <span className="row__marks">
            {fan.badges.length > 0 && <EarnedBadges record={{ badges: fan.badges }} compact />}
            {fan.streakDays > 0 && <span className="small">{fan.streakDays}-day active streak</span>}
          </span>
        )}
      </div>
      <span className="row__pts">
        {fmt(fan.points)}
        <small>PTS</small>
      </span>
    </li>
  );
}

export function SuperfanList({ fans, limit }: { fans: Superfan[]; limit?: number }) {
  const shown = limit ? fans.slice(0, limit) : fans;
  return (
    <ol className="board">
      {shown.map((fan) => (
        <SuperfanRow key={fan.handle} fan={fan} />
      ))}
    </ol>
  );
}

export function SuperfansPeek({ circle, sample }: { circle: CreatorCircle | null; sample: boolean }) {
  if (!circle || circle.fans.length === 0) return null;
  return (
    <section className="circle-peek" aria-labelledby="h-circle-peek">
      <div className="panel__head">
        <h2 className="label" id="h-circle-peek">
          Superfans of {circle.name}
        </h2>
        {sample && <SampleTag />}
      </div>
      <p className="small" style={{ marginBottom: 12 }}>
        Other fans of this creator, ranked by this season's site play. Following adds no points.
      </p>
      <SuperfanList fans={circle.fans} limit={5} />
      <p className="small" style={{ marginTop: 12 }}>
        <a href={`#/circle/${circle.slug}`}>Meet superfans</a> · <a href={`#/circle/${circle.slug}`}>See the full circle</a>
      </p>
    </section>
  );
}
