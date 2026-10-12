import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useStore } from '../app/store'

const HOUR = 60 * 60 * 1000

/** Shows "ready offline" once, and a refresh toast when a new version is waiting. */
export function UpdatePrompt() {
  const toast = useStore((s) => s.toast)
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return
      let last = Date.now()
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - last > HOUR) {
          last = Date.now()
          void reg.update()
        }
      })
    },
  })

  useEffect(() => {
    if (offlineReady) toast({ text: 'Ready to play offline ✿' })
  }, [offlineReady, toast])

  useEffect(() => {
    if (needRefresh) toast({ text: 'New version ready', sticky: true, action: { label: 'Refresh', run: () => void updateServiceWorker(true) } })
  }, [needRefresh, toast, updateServiceWorker])

  return null
}
