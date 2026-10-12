/** Tiny synthesized sound effects. The AudioContext is created lazily on the first user gesture. */
let ctx: AudioContext | null = null
let master: GainNode | null = null
let muted = false

/** Shared context for other synths (music). Null when muted or unsupported. */
export function audioContext(): AudioContext | null {
  return audio()
}

export function setMuted(m: boolean) {
  muted = m
}

function audio(): AudioContext | null {
  if (muted) return null
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.15
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, delay = 0, vol = 1) {
  const a = audio()
  if (!a || !master) return
  const t = a.currentTime + delay
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(f0, t)
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(master)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

export const sfx = {
  pickup: () => tone('sine', 520, 560, 0.05, 0, 0.7),
  drop: () => tone('sine', 300, 260, 0.04, 0, 0.4),
  /** pitch rises with combos (1 = normal) */
  snap: (pitch = 1) => tone('triangle', 660 * pitch, 880 * pitch, 0.08),
  lock: () => {
    tone('triangle', 660, 880, 0.08)
    tone('sine', 1320, 1320, 0.07, 0.04, 0.6)
  },
  hint: () => {
    tone('sine', 880, 880, 0.12, 0, 0.5)
    tone('sine', 1320, 1320, 0.16, 0.08, 0.4)
  },
  milestone: () => {
    ;[659.25, 783.99, 987.77].forEach((f, k) => tone('triangle', f, f, 0.16, k * 0.07, 0.7))
  },
  achievement: () => {
    ;[523.25, 783.99, 1046.5, 1567.98].forEach((f, k) => tone('sine', f, f, 0.26, k * 0.08, 0.6))
  },
  complete: () => {
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone('triangle', f, f, 0.22, k * 0.09, 0.9))
  },
}
