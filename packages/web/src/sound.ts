/** Small synthesised sound effects. No audio files; silent until the player has clicked something. */
type Cue = 'turn' | 'dice' | 'capture' | 'win';

const KEY = 'rajmandala-muted';
let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();

export const isMuted = () => muted;
export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    /* not remembered */
  }
}

const NOTES: Record<Cue, [frequency: number, start: number, length: number][]> = {
  turn: [[660, 0, 0.12], [880, 0.14, 0.2]],
  dice: [[220, 0, 0.05], [180, 0.06, 0.05], [240, 0.12, 0.06]],
  capture: [[392, 0, 0.1], [523, 0.1, 0.1], [659, 0.2, 0.22]],
  win: [[523, 0, 0.15], [659, 0.15, 0.15], [784, 0.3, 0.15], [1047, 0.45, 0.4]],
};

export function play(cue: Cue): void {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    for (const [frequency, start, length] of NOTES[cue]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = cue === 'dice' ? 'square' : 'triangle';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(cue === 'dice' ? 0.05 : 0.12, t0 + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + length + 0.02);
    }
  } catch {
    /* audio unavailable; the game is fully playable without it */
  }
}
