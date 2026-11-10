import { afterEach, describe, expect, it, vi } from "vitest";
import { runScanLoop } from "./scan-loop";
import type { Decoder } from "./decoder";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const frame = {} as ImageData;

afterEach(() => vi.restoreAllMocks());

describe("runScanLoop", () => {
  it("grabs again only after the decode settles and a 120 ms gap", async () => {
    const ctl = new AbortController();
    const events: string[] = [];
    const first = deferred<string[]>();
    let decodes = 0;
    const decoder: Decoder = {
      decode: vi.fn(() => {
        decodes += 1;
        events.push(`decode${decodes}`);
        return decodes === 1 ? first.promise : Promise.resolve([]);
      }),
    };
    const sleep = vi.fn(async (ms: number) => {
      events.push(`sleep${ms}`);
      if (events.filter((e) => e.startsWith("sleep")).length === 2) ctl.abort();
    });
    const done = runScanLoop({
      grab: () => {
        events.push("grab");
        return frame;
      },
      decoder,
      onText: (t) => events.push(`text:${t}`),
      signal: ctl.signal,
      sleep,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["grab", "decode1"]);
    first.resolve(["9780000000002"]);
    await done;
    expect(events).toEqual(["grab", "decode1", "text:9780000000002", "sleep120", "grab", "decode2", "sleep120"]);
  });

  it("stops when aborted", async () => {
    const ctl = new AbortController();
    const grab = vi.fn(() => frame);
    const decoder: Decoder = { decode: vi.fn(async () => []) };
    const sleep = vi.fn(async () => {
      if (grab.mock.calls.length === 3) ctl.abort();
    });
    await runScanLoop({ grab, decoder, onText: () => {}, signal: ctl.signal, sleep });
    expect(grab).toHaveBeenCalledTimes(3);
  });

  it("skips a missing frame and keeps going after a decode rejection", async () => {
    const ctl = new AbortController();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const frames = [null, frame, frame];
    const texts: string[] = [];
    let calls = 0;
    const decoder: Decoder = {
      decode: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("boom 9780000000002"), { name: "RuntimeError" });
        return ["9780000000019"];
      }),
    };
    const sleep = vi.fn(async () => {
      if (frames.length === 0) ctl.abort();
    });
    await runScanLoop({ grab: () => frames.shift() ?? null, decoder, onText: (t) => texts.push(t), signal: ctl.signal, sleep });
    expect(decoder.decode).toHaveBeenCalledTimes(2);
    expect(texts).toEqual(["9780000000019"]);
    expect(err).toHaveBeenCalledWith("Barcode decode failed", "RuntimeError");
  });

  it("drops texts decoded after an abort", async () => {
    const ctl = new AbortController();
    const texts: string[] = [];
    const decoder: Decoder = {
      decode: vi.fn(async () => {
        ctl.abort();
        return ["9780000000002"];
      }),
    };
    await runScanLoop({ grab: () => frame, decoder, onText: (t) => texts.push(t), signal: ctl.signal, sleep: async () => {} });
    expect(texts).toEqual([]);
  });

  it("does nothing when already aborted", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const grab = vi.fn(() => frame);
    await runScanLoop({ grab, decoder: { decode: async () => [] }, onText: () => {}, signal: ctl.signal });
    expect(grab).not.toHaveBeenCalled();
  });
});
