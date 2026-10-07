# Community membership → season-points eligibility

Overnight stub, 2026-10-07. Design and gated routes only. No live Discord or X
connection, no station restart, no vault, no mint, no open market.

## Contract

```text
OAuth or invite verification → attributed community → points eligibility
under the published season policy
```

Native season actions stay `question`, `poll_response`, and `accepted_work`.
Community membership is not a fourth farmable activity. A verified member may
become eligible for **one** published season-points credit per community per
season. That credit sits under the same daily and season caps. It is not
`$ICELAN`, not `$RLAN`, and not a token.

The fan board still ranks native credits only. A community credit is recorded
in `communities.json` when the operator publishes a weight and a verified
membership exists. It does not become a `settleSeason` event.

## Evidence

| Strength | How it is produced | Eligible? |
|---|---|---|
| `oauth_member` | Provider says this subject is a current member, with a join time older than the published age | Yes, if season policy publishes a weight |
| `invite_claimed` | Operator invite redeemed on a signed-in hub account | No. An invite note is not membership |
| missing / self-attested | "I joined" click, screenshot, webhook-only join | Refused |

Finish is **not wired**. A configured start can open Discord's or X's authorize
page. The callback cannot invent membership overnight.

## Abuse refusals

- A join click is not membership.
- Likes, posts, chat volume, viewer counts, and watch minutes never count.
- One provider identity belongs to one hub account.
- Fresh joins wait for `RADIOLAN_HUB_COMMUNITY_MIN_AGE` (default 72 hours).
- Repeat join/leave churn in the season is refused.
- Invite reuse is refused.
- Missing credentials stay **Needs credentials**, never a fake live connection.

Do not request Discord `guilds.join` or X write scopes. Those would create
joins, which this product refuses.

## Credentials (operator, not in the repo)

| Variable | Meaning |
|---|---|
| `RADIOLAN_HUB_DISCORD_CLIENT_ID` | Public Discord app id |
| `RADIOLAN_HUB_DISCORD_REDIRECT_URI` | Exact `https://<allowed-origin>/hub/discord` |
| `RADIOLAN_HUB_DISCORD_COMMUNITY_ID` | Guild id |
| `RADIOLAN_HUB_X_CLIENT_ID` | Public X app id |
| `RADIOLAN_HUB_X_REDIRECT_URI` | Exact `https://<allowed-origin>/hub/x` |
| `RADIOLAN_HUB_X_COMMUNITY_ID` | X community id |
| `RADIOLAN_HUB_COMMUNITY_WEIGHT` | Optional once-per-season points; default `0` (unpublished) |
| `RADIOLAN_HUB_COMMUNITY_MIN_AGE` | Seconds before a join can count; default `259200` |

Do not commit secrets, OAuth tokens, or invite plaintext. The store writes only
subject, community id, evidence strength, times, and invite hashes.

## Hub surfaces

- `#/communities` — gates, policy, refusal list
- Play and Profile link here
- How this works names the same rules
- `?preview=sample#/communities` is fictional and carries Sample tags
