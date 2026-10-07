import { useEffect, useState } from "react";
import type { HubApi } from "../data/api";
import {
  COMMUNITY_COPY,
  communityReasonCopy,
  gatedCommunityCatalog,
  hoursForMembership,
  sampleCommunityCatalog,
  type CommunityCatalog,
  type CommunityProviderCard,
} from "../data/community";
import { explainCommunityError, startCommunityLink } from "../data/community-link";
import type { HubSnapshot } from "../data/types";
import { ErrorBlock, Fact, Item, PageHead, SampleTag, Skeleton, Tag } from "../ui/atoms";

function ProviderCard({ card, sample, canStart, busy, onStart }: { card: CommunityProviderCard; sample: boolean; canStart: boolean; busy: boolean; onStart?: () => void }) {
  const gated = !card.credentials || !canStart;
  return (
    <section className="panel community-card" aria-labelledby={`h-${card.provider}`}>
      <div className="panel__head">
        <h2 className="h3" id={`h-${card.provider}`}>{card.label}</h2>
        {sample && <SampleTag />}
        {!card.credentials && <Tag kind="soon">{COMMUNITY_COPY.needsCredentials}</Tag>}
      </div>
      <dl className="facts">
        <Fact label="Membership">
          {card.membership
            ? <>{card.membership.displayName ?? card.membership.subject} · {card.membership.evidenceStrength === "oauth_member" ? "Verified member" : "Invite noted"}</>
            : "Not verified"}
        </Fact>
        <Fact label={COMMUNITY_COPY.eligibility}>
          {card.eligibility.eligible ? COMMUNITY_COPY.eligible : COMMUNITY_COPY.notEligible}
          {card.award > 0 && <> · +{card.award}</>}
          <span className="small block">{communityReasonCopy(card.eligibility.reason)}</span>
        </Fact>
      </dl>
      <button className="btn btn--primary btn--block" type="button" disabled={gated || busy || sample} onClick={onStart}>
        {COMMUNITY_COPY.verify}
      </button>
      {sample && <p className="small">{COMMUNITY_COPY.sampleNote} {COMMUNITY_COPY.notLive}</p>}
      {!sample && gated && <p className="small">{card.credentials ? COMMUNITY_COPY.oauthLater : COMMUNITY_COPY.needsCredentials}</p>}
    </section>
  );
}

export function Communities({ snapshot, catalog, busy = false, onStart, notice }: { snapshot: HubSnapshot | null; catalog: CommunityCatalog; busy?: boolean; onStart?: (provider: CommunityProviderCard["provider"]) => void; notice?: string }) {
  const sample = catalog.sample || snapshot?.scenario === "sample";
  const hours = hoursForMembership(catalog.policy.minMembershipSeconds);
  return (
    <>
      <PageHead title={COMMUNITY_COPY.title} lede={COMMUNITY_COPY.lede} />
      {sample && (
        <p className="note note--warn" style={{ marginBottom: 16 }}>
          <SampleTag /> {COMMUNITY_COPY.sampleNote} {COMMUNITY_COPY.notLive}
        </p>
      )}
      <section className="panel" aria-labelledby="h-community-policy">
        <div className="panel__head">
          <h2 className="label" id="h-community-policy">{COMMUNITY_COPY.policyLabel}</h2>
          {sample && <SampleTag />}
        </div>
        <dl className="facts">
          <Fact label={COMMUNITY_COPY.publishedCredit}>
            {catalog.policy.weight > 0 ? `+${catalog.policy.weight} ${COMMUNITY_COPY.underCaps}` : COMMUNITY_COPY.unpublished}
          </Fact>
          <Fact label={COMMUNITY_COPY.membershipAge}>{hours} hours before a join can count</Fact>
        </dl>
        <p className="small">{COMMUNITY_COPY.notTokens} {COMMUNITY_COPY.notIc}</p>
      </section>
      <div className="two community-grid">
        {catalog.providers.map((card) => (
          <ProviderCard key={card.provider} card={card} sample={sample} canStart={Boolean(onStart) && card.credentials && catalog.oauthWired} busy={busy} onStart={onStart ? () => onStart(card.provider) : undefined} />
        ))}
      </div>
      <section className="panel" aria-labelledby="h-community-refuse" style={{ marginTop: 16 }}>
        <div className="panel__head">
          <h2 className="label" id="h-community-refuse">{COMMUNITY_COPY.refused}</h2>
        </div>
        <ul className="list">
          <Item kind="x">{COMMUNITY_COPY.joinClick}</Item>
          <Item kind="x">{COMMUNITY_COPY.noFarm}</Item>
          <Item kind="x">{COMMUNITY_COPY.oneSubject}</Item>
          <Item kind="x">{COMMUNITY_COPY.freshJoin}</Item>
          <Item kind="x">{COMMUNITY_COPY.churn}</Item>
          <Item kind="x">{COMMUNITY_COPY.inviteWeak}</Item>
        </ul>
        <p className="small" style={{ marginTop: 12 }}>{COMMUNITY_COPY.inviteDisabled}</p>
      </section>
      {notice && <p className="small" role="status">{notice}</p>}
    </>
  );
}

export function CommunitiesPage({ snapshot, load, api, onRetry }: { snapshot: HubSnapshot | null; load: "loading" | "error" | "ready"; api?: HubApi; onRetry: () => void }) {
  const sample = snapshot?.scenario === "sample";
  const [catalog, setCatalog] = useState<CommunityCatalog>(() => sample ? sampleCommunityCatalog() : gatedCommunityCatalog());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (sample || !api) return;
    let active = true;
    api.communities().then((next) => { if (active) setCatalog(next); }).catch(() => { if (active) setCatalog(gatedCommunityCatalog()); });
    return () => { active = false; };
  }, [api, sample]);
  const head = <PageHead title={COMMUNITY_COPY.title} lede={COMMUNITY_COPY.lede} />;
  if (load === "loading") return <>{head}<Skeleton kinds={["block", "block"]} /></>;
  if (load === "error" && !snapshot) return <>{head}<ErrorBlock text="Communities didn't load. Nothing was changed." onRetry={onRetry} /></>;
  const start = api ? async (provider: CommunityProviderCard["provider"]) => {
    setBusy(true); setNotice("");
    try { await startCommunityLink(api, provider); }
    catch (error) { setNotice(explainCommunityError(error)); }
    finally { setBusy(false); }
  } : undefined;
  return <Communities snapshot={snapshot} catalog={catalog} busy={busy} onStart={start} notice={notice} />;
}
