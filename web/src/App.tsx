import { useStore } from './app/store'
import { Toasts } from './components/Toast'
import { UpdatePrompt } from './pwa/UpdatePrompt'
import { Home } from './screens/Home'
import { Play } from './screens/Play'

export function App() {
  const route = useStore((s) => s.route)
  return (
    <>
      {route.name === 'play' ? (
        <Play key={`${route.imageId}|${route.cols}x${route.rows}|${route.nonce ?? 0}`} imageId={route.imageId} cols={route.cols} rows={route.rows} />
      ) : (
        <Home />
      )}
      <Toasts />
      <UpdatePrompt />
    </>
  )
}
