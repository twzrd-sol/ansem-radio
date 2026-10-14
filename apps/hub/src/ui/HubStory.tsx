import { BETA_POINTS_LINE, HERO_STORY, HERO_TITLE } from "../data/public-copy";

export function HubHonesty() {
  return <p className="small">{BETA_POINTS_LINE}</p>;
}

export function HubStory({ compact = false, honesty = true }: { compact?: boolean; honesty?: boolean } = {}) {
  const Heading = compact ? "h2" : "h1";
  return (
    <div className={compact ? "hub-story hub-story--compact" : "hub-story"}>
      <p className="eyebrow">Radio LAN</p>
      <Heading className={compact ? "h2" : "h1"} tabIndex={compact ? undefined : -1}>
        {HERO_TITLE}
      </Heading>
      <p className="lede">{HERO_STORY}</p>
      {honesty ? <HubHonesty /> : null}
    </div>
  );
}
