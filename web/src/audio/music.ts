import { audioContext } from './sfx'

/**
 * Calm generative background music: slow pad chords (I–vi–IV–V family in C major)
 * with an occasional soft bell, all synthesized — no audio files.
 */
let timer = 0
let bus: GainNode | null = null
let step = 0

const CHORDS = [
  [261.63, 329.63, 392.0, 493.88], // Cmaj7
  [220.0, 261.63, 329.63, 392.0], // Am7
  [174.61, 220.0, 261.63, 329.63], // Fmaj7
  [196.0, 246.94, 293.66, 349.23], // G7
  [164.81, 196.0, 246.94, 293.66], // Em7
  [174.61, 220.0, 261.63, 349.23], // F
]
const PROGRESSIONS = [
  [0, 1, 2, 3],
  [0, 4, 2, 3],
  [2, 3, 1, 0],
  [0, 2, 5, 3],
]
const BELLS = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]

function pad(ctx: AudioContext, out: AudioNode, freqs: number[], t: number, dur: number) {
  for (const f of freqs) {
    for (const det of [-4, 4]) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f / 2
      o.detune.value = det
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.05, t + 1.6)
      g.gain.setValueAtTime(0.05, t + dur - 1.8)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      o.connect(g).connect(out)
      o.start(t)
      o.stop(t + dur + 0.05)
    }
  }
}

function bell(ctx: AudioContext, out: AudioNode, f: number, t: number) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'triangle'
  o.frequency.value = f
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.06, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4)
  o.connect(g).connect(out)
  o.start(t)
  o.stop(t + 2.5)
}

let prog = PROGRESSIONS[0]
function tick() {
  const ctx = audioContext()
  if (!ctx || !bus) return
  const t = ctx.currentTime + 0.05
  if (step % 4 === 0) prog = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)]
  pad(ctx, bus, CHORDS[prog[step % 4]], t, 7.2)
  if (Math.random() < 0.7) bell(ctx, bus, BELLS[Math.floor(Math.random() * BELLS.length)], t + 1 + Math.random() * 3)
  if (Math.random() < 0.35) bell(ctx, bus, BELLS[Math.floor(Math.random() * BELLS.length)], t + 4 + Math.random() * 2)
  step++
}

export function startMusic() {
  if (timer) return
  const ctx = audioContext()
  if (!ctx) return
  // Soft low-pass so the pad stays in the background.
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1800
  bus = ctx.createGain()
  bus.gain.setValueAtTime(0.0001, ctx.currentTime)
  bus.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 2)
  bus.connect(lp).connect(ctx.destination)
  step = 0
  tick()
  timer = window.setInterval(tick, 6000)
}

export function stopMusic() {
  if (!timer) return
  clearInterval(timer)
  timer = 0
  const ctx = audioContext()
  const b = bus
  bus = null
  if (ctx && b) {
    b.gain.cancelScheduledValues(ctx.currentTime)
    b.gain.setValueAtTime(Math.max(0.0001, b.gain.value), ctx.currentTime)
    b.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2)
    setTimeout(() => b.disconnect(), 1400)
  }
}
