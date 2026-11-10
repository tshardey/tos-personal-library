import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeedback, loadSoundOn, saveSoundOn } from "./feedback";

interface FakeOsc {
  type: string;
  frequency: { value: number };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function fakeAudio(state: AudioContextState = "running") {
  const instances: FakeCtx[] = [];
  class FakeCtx {
    state = state;
    currentTime = 0;
    sampleRate = 44100;
    destination = {};
    oscillators: FakeOsc[] = [];
    resume = vi.fn(async () => {});
    bufferSources: unknown[] = [];
    constructor() {
      instances.push(this);
    }
    createOscillator() {
      const o: FakeOsc = { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      this.oscillators.push(o);
      return o;
    }
    createGain() {
      return { gain: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
    }
    createBuffer() {
      return {};
    }
    createBufferSource() {
      const s = { buffer: null, connect: vi.fn(), start: vi.fn() };
      this.bufferSources.push(s);
      return s;
    }
  }
  return { Ctor: FakeCtx as unknown as typeof AudioContext, instances };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("createFeedback (D5)", () => {
  it("creates no context before unlock", () => {
    const { Ctor, instances } = fakeAudio();
    const vibrate = vi.fn(() => true);
    const fb = createFeedback({ AudioContextCtor: Ctor, vibrate });
    fb.accept();
    expect(instances).toHaveLength(0);
  });

  it("unlocks with resume and a silent buffer", () => {
    const { Ctor, instances } = fakeAudio();
    const fb = createFeedback({ AudioContextCtor: Ctor, vibrate: vi.fn(() => true) });
    fb.unlock();
    expect(instances).toHaveLength(1);
    expect(instances[0].resume).toHaveBeenCalled();
    expect(instances[0].bufferSources).toHaveLength(1);
    fb.unlock();
    expect(instances).toHaveLength(1);
  });

  it("beeps once at 1760 Hz on accept and twice at 880 Hz on notice", () => {
    const { Ctor, instances } = fakeAudio();
    const vibrate = vi.fn(() => true);
    const fb = createFeedback({ AudioContextCtor: Ctor, vibrate });
    fb.unlock();
    fb.accept();
    const ctx = instances[0];
    expect(ctx.oscillators.map((o) => o.frequency.value)).toEqual([1760]);
    expect(ctx.oscillators[0].type).toBe("sine");
    expect(ctx.oscillators[0].start).toHaveBeenCalled();
    expect(vibrate).toHaveBeenLastCalledWith(50);
    fb.notice();
    expect(ctx.oscillators.map((o) => o.frequency.value)).toEqual([1760, 880, 880]);
    expect(ctx.oscillators.slice(1).every((o) => o.start.mock.calls.length === 1)).toBe(true);
    expect(vibrate).toHaveBeenLastCalledWith([40, 60, 40]);
  });

  it("is silent and still when muted", () => {
    const { Ctor, instances } = fakeAudio();
    const vibrate = vi.fn(() => true);
    const fb = createFeedback({ AudioContextCtor: Ctor, vibrate });
    fb.unlock();
    fb.setMuted(true);
    fb.accept();
    fb.notice();
    expect(instances[0].oscillators).toHaveLength(0);
    expect(vibrate).not.toHaveBeenCalled();
    fb.setMuted(false);
    fb.accept();
    expect(instances[0].oscillators).toHaveLength(1);
  });

  it("never throws without vibrate or with a suspended context", () => {
    const { Ctor, instances } = fakeAudio("suspended");
    const fb = createFeedback({ AudioContextCtor: Ctor });
    expect(() => {
      fb.unlock();
      fb.accept();
      fb.notice();
    }).not.toThrow();
    expect(instances[0].oscillators).toHaveLength(0);
  });

  it("never throws when the constructor throws", () => {
    const Ctor = function () {
      throw new Error("no audio");
    } as unknown as typeof AudioContext;
    const fb = createFeedback({ AudioContextCtor: Ctor, vibrate: () => {
      throw new Error("no vibrate");
    } });
    expect(() => {
      fb.unlock();
      fb.accept();
      fb.notice();
    }).not.toThrow();
  });
});

describe("sound preference", () => {
  it("defaults on and is remembered under tpl_scan_sound", () => {
    expect(loadSoundOn()).toBe(true);
    saveSoundOn(false);
    expect(loadSoundOn()).toBe(false);
    expect(Object.keys(localStorage)).toEqual(["tpl_scan_sound"]);
  });

  it("defaults on when storage is blocked", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom });
    expect(loadSoundOn()).toBe(true);
    expect(() => saveSoundOn(false)).not.toThrow();
  });
});
