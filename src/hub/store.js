/**
 * Hub account storage: one JSON document (accounts, credentials, sessions) rewritten atomically, and an
 * append-only JSONL of activity submissions. Zero dependencies, loopback station only. The directory is created
 * mode 0o700. Nothing here holds a fan's key: credentials are public keys, sessions are random ids.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, truncateSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultHubDir(env = process.env) {
  return env.RADIOLAN_HUB_DIR || join(homedir(), ".local", "share", "radiolan", "hub");
}

const EMPTY = () => ({ v: 1, accounts: {}, credentials: {}, sessions: {} });

export function createHubStore({ dir = defaultHubDir() } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const statePath = join(dir, "accounts.json");
  const submissionsPath = join(dir, "submissions.jsonl");
  let state = EMPTY();
  if (existsSync(statePath)) {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    if (parsed?.v !== 1) throw new TypeError("unknown hub store version");
    state = parsed;
  }
  const submissions = [];
  let tailNeedsDelimiter = false;
  if (existsSync(submissionsPath)) {
    const text = readFileSync(submissionsPath, "utf8");
    const elements = text.split("\n");
    // "a\nb\n" splits to ["a", "b", ""] while an unterminated "a\nb" splits to ["a", "b"], so only when
    // the file lacks its final delimiter can the last element be an incomplete write. A fragment that
    // still parses as a JSON object loads as a record and the next append closes the line; anything
    // malformed there is discarded and truncated now so a later append cannot weld onto it. Interior
    // lines always parse, so corruption anywhere else still throws with the file line number.
    const fragment = elements.at(-1) !== "" ? elements.pop() : null;
    for (let i = 0; i < elements.length; i++) {
      const line = elements[i];
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (cause) {
        throw new SyntaxError(`invalid submission record: ${submissionsPath}:${i + 1}`, { cause });
      }
      submissions.push(parsed);
    }
    if (fragment !== null) {
      let tail;
      try {
        tail = JSON.parse(fragment);
      } catch {
        tail = undefined;
      }
      if (tail !== null && typeof tail === "object" && !Array.isArray(tail)) {
        submissions.push(tail);
        tailNeedsDelimiter = true;
      } else {
        const validPrefix = text.slice(0, text.length - fragment.length);
        truncateSync(submissionsPath, Buffer.byteLength(validPrefix, "utf8"));
      }
    }
  }
  // Writes the next state to disk first and only then adopts it, so a failed write leaves memory and disk agreeing.
  const flush = (next = state) => {
    const tmp = `${statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    renameSync(tmp, statePath);
    state = next;
  };
  return {
    dir,
    account: (id) => state.accounts[id] ?? null,
    accountByCredential: (credentialId) => {
      const id = state.credentials[credentialId];
      return id ? state.accounts[id] ?? null : null;
    },
    accountByUserHandle: (handle) => Object.values(state.accounts).find((a) => a.userHandle === handle) ?? null,
    createAccount: (account) => {
      if (state.accounts[account.id]) throw new Error("account exists");
      for (const c of account.credentials) if (state.credentials[c.credentialId]) throw new Error("credential exists");
      const credentials = { ...state.credentials };
      for (const c of account.credentials) credentials[c.credentialId] = account.id;
      flush({ ...state, accounts: { ...state.accounts, [account.id]: account }, credentials });
      return account;
    },
    updateAccount: (id, patch) => {
      const current = state.accounts[id];
      if (!current) throw new Error("no such account");
      flush({ ...state, accounts: { ...state.accounts, [id]: { ...current, ...patch } } });
      return state.accounts[id];
    },
    joinedCount: (season) => Object.values(state.accounts).filter((a) => a.joined?.[season]).length,
    session: (id) => state.sessions[id] ?? null,
    createSession: (session) => {
      flush({ ...state, sessions: { ...state.sessions, [session.id]: session } });
      return session;
    },
    deleteSession: (id) => {
      if (state.sessions[id]) {
        const sessions = { ...state.sessions };
        delete sessions[id];
        flush({ ...state, sessions });
      }
    },
    expireSessions: (now) => {
      const sessions = Object.fromEntries(Object.entries(state.sessions).filter(([, s]) => s.expiresAt > now));
      if (Object.keys(sessions).length !== Object.keys(state.sessions).length) flush({ ...state, sessions });
    },
    submissions: () => submissions.slice(),
    addSubmission: (row) => {
      appendFileSync(
        submissionsPath,
        `${tailNeedsDelimiter ? "\n" : ""}${JSON.stringify(row)}\n`,
        { mode: 0o600 },
      );
      tailNeedsDelimiter = false;
      submissions.push(row);
      return row;
    },
    counts: () => ({ accounts: Object.keys(state.accounts).length, sessions: Object.keys(state.sessions).length, submissions: submissions.length }),
  };
}
