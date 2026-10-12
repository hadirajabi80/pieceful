/// <reference lib="webworker" />
import { buildGeometry, type CutParams } from '../engine/geometry'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = (e: MessageEvent<{ type: 'cut'; params: CutParams }>) => {
  if (e.data.type !== 'cut') return
  try {
    const geo = buildGeometry(e.data.params, (done, total) => self.postMessage({ type: 'progress', done, total }))
    self.postMessage({ type: 'done', geo }, [
      geo.outlinePts.buffer,
      geo.outlineStart.buffer,
      geo.fillVBO,
      geo.fillIdx.buffer,
      geo.fillStart.buffer,
      geo.stripVBO,
      geo.stripIdx.buffer,
      geo.stripStart.buffer,
      geo.avgLab.buffer,
      geo.avgRgb.buffer,
    ])
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
