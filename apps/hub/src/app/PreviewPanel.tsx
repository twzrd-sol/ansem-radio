import { useEffect, useRef } from "react";

import { Icon } from "../ui/atoms";
import { writePreview, type PreviewState } from "./preview";

type Option<T> = readonly [T, string];

function Control<K extends keyof PreviewState>({ label, field, options, preview }: { label: string; field: K; options: ReadonlyArray<Option<PreviewState[K]>>; preview: PreviewState }) {
  return (
    <fieldset className="pv">
      <legend className="label">{label}</legend>
      <div className="seg">
        {options.map(([value, text]) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={preview[field] === value}
            onClick={() => writePreview({ ...preview, [field]: value, ...(field === "position" ? { flow: "edit" } : {}) })}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Design-review controls. Not part of the product; only rendered with ?preview=sample or ?preview=today. */
export function PreviewPanel({ preview, onClose }: { preview: PreviewState; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.querySelector("button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside id="preview" ref={panel} className="preview" aria-labelledby="preview-title">
      <div className="preview__head">
        <h2 className="h3" id="preview-title">
          Design preview
        </h2>
        <button className="icon-btn" type="button" aria-label="Close design preview" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <p className="small">Not part of the product. These switches change the fixtures and states so every screen can be reviewed. Blocks marked SAMPLE show fixtures.</p>
      <Control label="Scenario" field="scenario" preview={preview} options={[["sample", "Sample season"], ["today", "Today"]] as const} />
      <Control label="Data" field="data" preview={preview} options={[["ready", "Ready"], ["loading", "Loading"], ["error", "Error"]] as const} />
      <Control label="Fan" field="joined" preview={preview} options={[[true, "Joined"], [false, "Not joined"]] as const} />
      <Control label="Backing position" field="position" preview={preview} options={[["none", "None"], ["active", "Active"], ["requested", "Requested"], ["releasable", "Releasable"]] as const} />
      <Control label="Backing step" field="flow" preview={preview} options={[["edit", "Amount"], ["connect", "Wallet"], ["review", "Review"], ["signing", "Signing"], ["done", "Done"], ["failed", "Failed"]] as const} />
      <Control label="Failure" field="fail" preview={preview} options={[["cancelled", "Cancelled"], ["simulation", "Simulation"], ["network", "Network"], ["expired", "Expired"]] as const} />
    </aside>
  );
}
