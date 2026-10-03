import { afterEach, describe, expect, it, vi } from "vitest";
import { watchVisible } from "./refresh";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("always-on reads", () => {
  it("polls while visible, catches up on return and stops on unmount", async () => {
    vi.useFakeTimers();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const win = new EventTarget();
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", win);
    const read = vi.fn(async () => {});
    const stop = watchVisible(read);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    doc.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(120_000);
    expect(read).toHaveBeenCalledTimes(2);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(3);
    win.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(4);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("does not pile up reads while a poll is pending", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("window", new EventTarget());
    let release!: () => void;
    const read = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const stop = watchVisible(read);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(read).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    release();
    stop();
  });
});
