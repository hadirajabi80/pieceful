const COLORS = ['#F28DA6', '#8FC9C1', '#F7C978', '#B9A7E6', '#FFFFFF']

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  size: number
  color: string
  round: boolean
  delay: number
}

/** Tiny screen-space confetti burst, drawn by the renderer. */
export class Confetti {
  private parts: Particle[] = []
  private last = 0
  active = false

  start(w: number, h: number) {
    this.parts = []
    for (let burst = 0; burst < 2; burst++) {
      const ox = burst === 0 ? w * 0.3 : w * 0.7
      for (let k = 0; k < 60; k++) {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.6
        const sp = 520 + Math.random() * 520
        this.parts.push({
          x: ox,
          y: h * 0.62,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 12,
          size: 6 + Math.random() * 6,
          color: COLORS[(Math.random() * COLORS.length) | 0],
          round: Math.random() < 0.35,
          delay: burst * 0.18,
        })
      }
    }
    this.last = performance.now()
    this.active = true
  }

  /** A small celebratory pop at a screen point (milestones, combos). */
  burst(x: number, y: number, count = 36, power = 1) {
    if (!this.active) this.parts = []
    for (let k = 0; k < count; k++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4
      const sp = (260 + Math.random() * 360) * power
      this.parts.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
        size: 5 + Math.random() * 5,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        round: Math.random() < 0.4,
        delay: 0,
      })
    }
    this.last = performance.now()
    this.active = true
  }

  /** Advances and draws; returns false when finished. */
  step(ctx: CanvasRenderingContext2D, now: number, h: number): boolean {
    if (!this.active) return false
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    let alive = 0
    for (const p of this.parts) {
      if (p.delay > 0) {
        p.delay -= dt
        alive++
        continue
      }
      p.vy += 1500 * dt
      p.vx *= 1 - 1.6 * dt
      p.vy *= 1 - 1.2 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
      if (p.y > h + 40) continue
      alive++
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      if (p.round) {
        ctx.beginPath()
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      }
      ctx.restore()
    }
    if (!alive) this.active = false
    return this.active
  }
}
