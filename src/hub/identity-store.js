// SPDX-License-Identifier: MIT
// Optional links live beside accounts, outside submissions and points. No token or signature is persisted.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HttpError } from "../platform/guard.js";

export function createHubIdentityStore({ dir }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "identities.json");
  let state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { v: 1, accounts: {} };
  if (state?.v !== 1 || !state.accounts || typeof state.accounts !== "object" || Array.isArray(state.accounts)) throw new TypeError("unknown hub identity store version");
  const get = (id) => structuredClone(state.accounts[id] ?? { twitch: null, wallet: null });
  const commit = (id, patch) => {
    if (!/^[0-9a-f]{64}$/.test(id)) throw new TypeError("hub account id required");
    const next = { ...state, accounts: { ...state.accounts, [id]: { ...get(id), ...patch } } };
    writeFileSync(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    state = next;
    return get(id);
  };
  return {
    get,
    link(id, kind, record) {
      if (!["twitch", "wallet"].includes(kind)) throw new TypeError("unknown identity kind");
      const field = kind === "twitch" ? "subject" : "address";
      if (Object.entries(state.accounts).some(([other, links]) => other !== id && links[kind]?.[field] === record[field])) throw new HttpError(409, `${kind}_already_linked_elsewhere`);
      if (get(id)[kind] && get(id)[kind][field] !== record[field]) throw new HttpError(409, `${kind}_unlink_first`);
      return commit(id, { [kind]: record });
    },
    unlink(id, kind) {
      if (!["twitch", "wallet"].includes(kind)) throw new TypeError("unknown identity kind");
      return commit(id, { [kind]: null });
    },
  };
}
