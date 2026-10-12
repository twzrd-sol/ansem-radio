import { HERO_STORY, HERO_TITLE, VAULT_HOLDS, heroHonestCopy } from "../data/public-copy";

export function HubStory({ compact = false }: { compact?: boolean } = {}) {
  const Heading = compact ? "h2" : "h1";
  return (
    <div className={compact ? "hub-story hub-story--compact" : "hub-story"}>
      <p className="eyebrow">Radio LAN</p>
      <Heading className={compact ? "h2" : "h1"} tabIndex={compact ? undefined : -1}>
        {HERO_TITLE}
      </Heading>
      <p className="lede">{HERO_STORY}</p>
      <p className="small fine">{heroHonestCopy()} {VAULT_HOLDS}</p>
    </div>
  );
}
