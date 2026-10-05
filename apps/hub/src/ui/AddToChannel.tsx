// "Add this to your channel": a live badge a streamer can paste into their own site or README, or download as an image
// for a Twitch panel. Shown on any listing that has a Twitch channel. It carries no points or money figure.
import { useState } from "react";

import { badgePng, embedSnippets } from "../data/embed";
import { Icon } from "./atoms";

export function AddToChannel({ slug, name }: { slug: string; name: string }) {
  const [note, setNote] = useState("");
  const here = typeof window === "undefined" ? { origin: "https://radiolan.live", pathname: "/hub/" } : window.location;
  const s = embedSnippets({ origin: here.origin, pathname: here.pathname, slug, name });
  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote(`${label} copied.`);
    } catch {
      setNote("Copying isn't available here. Select the text and copy it.");
    }
  };
  const download = async () => {
    try {
      const blob = await badgePng(s.badgeUrl);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug}-radio-lan-panel.png`;
      link.click();
      URL.revokeObjectURL(url);
      setNote("Image saved. In your Twitch panel, upload it and set the link to your listing page.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "The image couldn't be made.");
    }
  };
  return (
    <section className="section" aria-labelledby="h-addto">
      <div className="section__head">
        <h2 className="h2" id="h-addto">
          Add this to your channel
        </h2>
        <span className="label">For streamers · free</span>
      </div>
      <img className="addto__badge" src={s.badgeUrl} alt={`${name} on Radio LAN, live badge`} width={320} height={140} />
      <p className="small">A live badge for your own site or README. For a Twitch panel, save it as an image and upload it with a link to this page.</p>
      <label className="label" htmlFor="addto-html">Website or README (HTML)</label>
      <textarea id="addto-html" className="addto__code" readOnly rows={3} value={s.html} onFocus={(e) => e.currentTarget.select()} />
      <label className="label" htmlFor="addto-md">Markdown</label>
      <textarea id="addto-md" className="addto__code" readOnly rows={2} value={s.markdown} onFocus={(e) => e.currentTarget.select()} />
      <div className="actions">
        <button className="btn" type="button" onClick={() => void copy("HTML", s.html)}>
          Copy HTML
        </button>
        <button className="btn" type="button" onClick={() => void copy("Markdown", s.markdown)}>
          Copy Markdown
        </button>
        <button className="btn btn--ghost" type="button" onClick={() => void download()}>
          <Icon name="ext" size="sm" />
          Save as panel image
        </button>
      </div>
      <p className="small fine" role="status" aria-live="polite">
        {note || "The badge shows your channel's public Twitch status, labelled Data: Twitch."}
      </p>
    </section>
  );
}
