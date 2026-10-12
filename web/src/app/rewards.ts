import { sfx } from '../audio/sfx'
import type { Achievement } from './profile'
import { useStore } from './store'

/** Toasts newly unlocked achievements (staggered so several don't collide). */
export function announce(list: Achievement[]) {
  list.forEach((a, k) =>
    setTimeout(() => {
      sfx.achievement()
      useStore.getState().toast({ text: `🏆 ${a.title} — ${a.desc}` })
    }, k * 1600),
  )
}
