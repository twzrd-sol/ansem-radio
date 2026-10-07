// SPDX-License-Identifier: MIT
// Attributed community membership lives beside accounts, outside native submissions.
// No OAuth token, invite plaintext, chat, or login is persisted.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HttpError } from "../platform/guard.js";
import { COMMUNITY_PROVIDERS, hashInviteToken } from "./community.js";

const empty = () => ({ v: 1, memberships: {}, subjects: {}, invites: {}, credits: {}, churn: {} });

export function createCommunityStore({ dir }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "communities.json");
  let state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : empty();
  if (state?.v !== 1 || ["memberships", "subjects", "invites", "credits", "churn"].some((key) => !state[key] || typeof state[key] !== "object" || Array.isArray(state[key]))) {
    throw new TypeError("unknown hub community store version");
  }
  const commit = (next) => {
    writeFileSync(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    state = next;
    return state;
  };
  return {
    membershipsOf(accountId) {
      return structuredClone(state.memberships[accountId] ?? []);
    },
    subjectOwner(provider, subject) {
      return state.subjects[`${provider}:${subject}`] ?? null;
    },
    churnOf(provider, subject, communityId) {
      return structuredClone(state.churn[`${provider}:${subject}:${communityId}`] ?? []);
    },
    creditOf(season, accountId, communityId) {
      return structuredClone(state.credits[`${season}:${accountId}:${communityId}`] ?? null);
    },
    issueInvite({ communityId, token, expiresAt }) {
      const id = hashInviteToken(token);
      if (state.invites[id]) throw new HttpError(409, "invite_reused");
      commit({ ...state, invites: { ...state.invites, [id]: { communityId, usedBy: null, usedAt: null, expiresAt } } });
      return id;
    },
    redeemInvite({ token, accountId, now }) {
      const id = hashInviteToken(token);
      const row = state.invites[id];
      if (!row) throw new HttpError(400, "community_invite_invalid");
      if (row.usedBy || (row.expiresAt != null && row.expiresAt <= now)) throw new HttpError(409, "invite_reused");
      commit({
        ...state,
        invites: { ...state.invites, [id]: { ...row, usedBy: accountId, usedAt: now } },
      });
      return { communityId: row.communityId };
    },
    recordMembership(accountId, membership) {
      if (!/^[0-9a-f]{64}$/.test(accountId)) throw new TypeError("hub account id required");
      if (!COMMUNITY_PROVIDERS.includes(membership.provider)) throw new TypeError("unknown community provider");
      const subjectKey = `${membership.provider}:${membership.subject}`;
      const owner = state.subjects[subjectKey];
      if (owner && owner !== accountId) throw new HttpError(409, "subject_already_linked");
      const current = state.memberships[accountId] ?? [];
      const nextRows = [...current.filter((row) => row.provider !== membership.provider), membership];
      return commit({
        ...state,
        memberships: { ...state.memberships, [accountId]: nextRows },
        subjects: { ...state.subjects, [subjectKey]: accountId },
      });
    },
    recordChurn(provider, subject, communityId, event) {
      const key = `${provider}:${subject}:${communityId}`;
      const events = [...(state.churn[key] ?? []), event];
      commit({ ...state, churn: { ...state.churn, [key]: events } });
      return events;
    },
    recordCredit({ season, accountId, communityId, award, at }) {
      const key = `${season}:${accountId}:${communityId}`;
      if (state.credits[key]) throw new HttpError(409, "already_credited");
      commit({ ...state, credits: { ...state.credits, [key]: { award, at } } });
      return state.credits[key];
    },
  };
}
