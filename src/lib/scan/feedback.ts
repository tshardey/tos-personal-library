export interface FeedbackEnv {
  AudioContextCtor?: typeof AudioContext;
  vibrate?: (pattern: number | number[]) => boolean;
}

export interface Feedback {
  /** Call synchronously in a tap handler (iOS); later taps retry resume(). */
  unlock(): void;
  /** New row: one 1760 Hz beep and a 50 ms buzz. */
  accept(): void;
  /** Repeat prompt, already owned, open elsewhere: two 880 Hz beeps. */
  notice(): void;
  setMuted(muted: boolean): void;
}

const GAIN = 0.2;

function defaultCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext;
}

function defaultVibrate(): FeedbackEnv["vibrate"] {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return undefined;
  return (p) => navigator.vibrate(p);
}

/** D5. Never throws; makes no AudioContext until unlock(). */
export function createFeedback(env: FeedbackEnv = {}): Feedback {
  const Ctor = env.AudioContextCtor ?? defaultCtor();
  const vibrate = env.vibrate ?? defaultVibrate();
  let ctx: AudioContext | null = null;
  let muted = false;

  const buzz = (pattern: number | number[]) => {
    try {
      vibrate?.(pattern);
    } catch {
      // No vibration here; the visual flash still shows.
    }
  };

  const beep = (c: AudioContext, freq: number, offsetS: number, durationS: number) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.value = GAIN;
    osc.connect(gain);
    gain.connect(c.destination);
    const at = c.currentTime + offsetS;
    osc.start(at);
    osc.stop(at + durationS);
  };

  const play = (tones: [freq: number, offsetS: number, durationS: number][]) => {
    try {
      const c = ctx;
      if (!c) return;
      if (c.state !== "running") {
        // iOS suspends it when the tab is hidden: skip this sound; the next tap's unlock() resumes it.
        void c.resume().catch(() => {});
        return;
      }
      for (const [f, o, d] of tones) beep(c, f, o, d);
    } catch {
      // Sound is best-effort.
    }
  };

  return {
    unlock() {
      try {
        if (ctx) {
          if (ctx.state !== "running") void ctx.resume().catch(() => {});
          return;
        }
        if (!Ctor) return;
        const c = new Ctor();
        ctx = c;
        void c.resume().catch(() => {});
        // A zero-gain 10 ms buffer played inside the tap is what unlocks Web Audio on iOS.
        const buffer = c.createBuffer(1, Math.max(1, Math.round(c.sampleRate * 0.01)), c.sampleRate);
        const src = c.createBufferSource();
        const gain = c.createGain();
        gain.gain.value = 0;
        src.buffer = buffer;
        src.connect(gain);
        gain.connect(c.destination);
        src.start(0);
      } catch {
        // No audio on this device; feedback falls back to vibration and the flash.
      }
    },
    accept() {
      if (muted) return;
      play([[1760, 0, 0.09]]);
      buzz(50);
    },
    notice() {
      if (muted) return;
      play([
        [880, 0, 0.07],
        [880, 0.13, 0.07],
      ]);
      buzz([40, 60, 40]);
    },
    setMuted(m) {
      muted = m;
    },
  };
}

const SOUND_KEY = "tpl_scan_sound";

/** D5: the sound toggle, default on. */
export function loadSoundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveSoundOn(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Not remembered.
  }
}
