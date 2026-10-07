import type { ReactNode } from "react";

import { explorerUrl } from "../chain/config";
import type { Station } from "../data/station";
import { short } from "../lib/format";

const ICONS = {
  stream: ["M3 7.5h18V19H3z", "m8.5 3.5 3.5 4 3.5-4"],
  play: ["M13 2.5 4.5 14h7l-1 7.5L19 10h-7z"],
  board: ["M5 20v-8", "M12 20V4", "M19 20v-11"],
  home: ["M3 11 12 4l9 7", "M5.5 9.5V20h13V9.5", "M10 20v-5.5h4V20"],
  me: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"],
  heart: ["M12 20.5s-7-4.4-8.8-9.1C1.9 7.7 4.4 4.5 7.6 4.5c1.9 0 3.4 1 4.4 2.5 1-1.5 2.5-2.5 4.4-2.5 3.2 0 5.7 3.2 4.4 6.9-1.8 4.7-8.8 9.1-8.8 9.1z"],
  ext: ["M7 17 17 7", "M8.5 7H17v8.5"],
  check: ["M5 12.5 10 17.5 19 7"],
  x: ["M6 6l12 12", "M18 6 6 18"],
  lock: ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  wallet: ["M3.5 7.5h15a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-15z", "M3.5 7.5l11.5-3v3", "M16.5 13.75h1.5"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7.5V12l3 2"],
  poll: ["M4 6.5h9", "M4 12h16", "M4 17.5h6"],
  question: ["M9.4 9.2a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1 .9-1 1.6v.6", "M12 17.4v.4", "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"],
  mic: ["M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z", "M5.5 11a6.5 6.5 0 0 0 13 0", "M12 17.5V21"],
  film: ["M4 4.5h16v15H4z", "M4 9h16", "M4 15h16", "M8.5 4.5V9", "M15.5 4.5V9", "M8.5 15v4.5", "M15.5 15v4.5"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 11v5.5", "M12 7.8v.4"],
  chev: ["M14.5 18 8.5 12l6-6"],
  next: ["M9.5 6l6 6-6 6"],
  search: ["M10.5 3.5a7 7 0 1 1 0 14 7 7 0 0 1 0-14z", "M15.5 15.5 21 21"],
  star: ["M12 3.5l2.5 5.3 5.8.8-4.2 4 1 5.8L12 16.6l-5.1 2.8 1-5.8-4.2-4 5.8-.8z"],
  receipt: ["M6 3h12v18l-3-2-3 2-3-2-3 2z", "M9 8h6", "M9 12h6"],
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size }: { name: IconName; size?: "sm" | "lg" | "xl" }) {
  return (
    <svg viewBox="0 0 24 24" className={size ? `ico ico--${size}` : "ico"} aria-hidden="true" focusable="false">
      {ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** LAN, the broadcast console: a CRT with two amber waveform eyes. A console, never a face. */
export function LanMark({ className }: { className: string }) {
  const eyes = [10.5, 21.5].flatMap((x0) => [3, 7, 10, 7, 3].map((len, i) => ({ x: x0 + i * 1.8, y: 18.5 - len / 2, len })));
  return (
    <svg viewBox="0 0 40 40" className={`lan ${className}`} aria-hidden="true" focusable="false">
      <rect className="lan__case" x="3" y="5" width="34" height="27" rx="7" />
      <rect className="lan__screen" x="7" y="9" width="26" height="19" rx="4" />
      {eyes.map((e) => (
        <rect key={`${e.x}-${e.len}`} className="lan__eye" x={e.x} y={e.y} width="1.1" height={e.len} rx="0.55" />
      ))}
      <rect className="lan__case" x="15" y="33" width="10" height="2.5" rx="1.25" />
    </svg>
  );
}

export const Tag = ({ kind, children }: { kind: "sample" | "net" | "soon"; children: ReactNode }) => <span className={`tag tag--${kind}`}>{children}</span>;
export const SampleTag = () => <Tag kind="sample">Sample</Tag>;

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="ext" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <Icon name="ext" size="sm" />
    </a>
  );
}

/** A real address links to the explorer; a fixture is shown unlinked with a SAMPLE mark. */
export function Address({ id, sample = false, kind = "address" }: { id: string; sample?: boolean; kind?: "address" | "tx" }) {
  if (sample) {
    return (
      <span className="addr">
        <span className="mono">{short(id)}</span>
        <SampleTag />
      </span>
    );
  }
  return (
    <Ext href={explorerUrl(kind, id)}>
      <span className="mono">{short(id)}</span>
    </Ext>
  );
}

export function Stat({ label, value, note, word = false }: { label: string; value: ReactNode; note?: string; word?: boolean }) {
  return (
    <div className="stat">
      <p className="label">{label}</p>
      <p className={word ? "stat__value stat__value--text" : "stat__value"}>{value}</p>
      {note && <p className="stat__note">{note}</p>}
    </div>
  );
}

export const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

export function Item({ kind, children }: { kind: "check" | "x" | "lock" | "info"; children: ReactNode }) {
  const tone = kind === "check" ? "is-yes" : kind === "x" ? "is-no" : "is-info";
  return (
    <li>
      <span className={tone}>
        <Icon name={kind} />
      </span>
      <span>{children}</span>
    </li>
  );
}

export function Dots({ used, cap }: { used: number; cap: number }) {
  return (
    <span className="dots" role="img" aria-label={`${used} of ${cap} used today`}>
      {Array.from({ length: cap }, (_, i) => (
        <i key={i} className={i < used ? "on" : undefined} />
      ))}
    </span>
  );
}

export function Vu({ value, max, segments = 24 }: { value: number; max: number; segments?: number }) {
  const on = Math.round((value / max) * segments);
  return (
    <div className="vu" role="meter" aria-label="Points so far against the season cap" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      {Array.from({ length: segments }, (_, i) => (
        <i key={i} className={[i < on && "on", i >= segments - 4 && "hot"].filter(Boolean).join(" ") || undefined} />
      ))}
    </div>
  );
}

export function Skeleton({ kinds }: { kinds: Array<"line" | "title" | "block" | "card"> }) {
  return (
    <div className="skel-stack" aria-busy="true" role="status" aria-label="Loading">
      {kinds.map((kind, i) => (
        <div key={i} className={`skel skel--${kind}`} />
      ))}
    </div>
  );
}

export function ErrorBlock({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="result result--error" role="alert">
      <Icon name="info" size="lg" />
      <p className="h3">Couldn't load</p>
      <p className="small">{text}</p>
      {onRetry && (
        <button className="btn" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyBlock({ icon, title, text, children }: { icon: IconName; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size="xl" />
      <p className="h3">{title}</p>
      <p className="small">{text}</p>
      {children}
    </div>
  );
}

export function PageHead({ eyebrow, title, lede, before }: { eyebrow?: string; title: string; lede?: ReactNode; before?: ReactNode }) {
  return (
    <header className="page-head">
      {before}
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="h1" tabIndex={-1}>
        {title}
      </h1>
      {lede && <p className="lede">{lede}</p>}
    </header>
  );
}

export function StationPill({ station }: { station: Station }) {
  const live = station.status === "ready" && station.live;
  const text = `Data: Twitch · ${station.status === "ready" ? (station.live ? "Live" : "Offline") : station.status === "loading" ? "Checking" : "Status unknown"}`;
  return (
    <span className={live ? "pill pill--live" : "pill"} title="Data: Twitch.">
      <span className="pill__dot" aria-hidden="true" />
      {text}
    </span>
  );
}
