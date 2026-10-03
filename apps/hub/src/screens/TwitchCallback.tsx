import { useEffect, useRef, useState } from "react";
import { createHubApi } from "../data/api";
import { completeTwitchCallback, explainIdentityError, type TwitchCallbackData } from "../data/twitch-link";
import { LanMark, PageHead } from "../ui/atoms";

export function TwitchCallback({ callback }: { callback: TwitchCallbackData }) {
  const [message, setMessage] = useState("Checking your Twitch identity");
  const [done, setDone] = useState(false);
  const attempt = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    let active = true;
    // StrictMode remounts effects. Share one attempt so the single-use proof is never submitted twice.
    attempt.current ??= completeTwitchCallback(createHubApi(), callback);
    attempt.current.then(() => { if (active) { setMessage("Twitch linked. Your points are unchanged."); setDone(true); } }).catch((error: unknown) => { if (active) { setMessage(explainIdentityError(error)); setDone(true); } });
    return () => { active = false; };
  }, [callback]);
  return <main className="view identity-callback"><LanMark className="brand__mark" /><PageHead title="Link Twitch" /><section className="panel"><p role="status">{message}</p>{done && <a className="btn" href="/hub/#/me">Back to Me</a>}</section></main>;
}
