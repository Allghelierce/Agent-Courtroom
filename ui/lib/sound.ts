// Tiny chiptune sounds made with WebAudio, so there are no audio files to ship. Off until the viewer turns them on.

let ctx: AudioContext | null = null;
let enabled = false;

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (on && !ctx) ctx = new AudioContext();
  if (on) void ctx?.resume();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "square", gain = 0.05) {
  if (!enabled || !ctx) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

// Each speaker has their own text blip pitch, like a visual novel.
const BLIP: Record<string, number> = { judge: 330, pros: 620, def: 520, worker: 880, clerk: 440 };

export function blip(who: string) {
  tone(BLIP[who] ?? 440, 0, 0.035, "square", 0.03);
}

export function objection() {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.06, 0.12, "square", 0.06));
}

export function gavel() {
  tone(110, 0, 0.18, "triangle", 0.25);
  tone(70, 0.02, 0.25, "square", 0.08);
}
