import { useRef, useState } from 'react'
import { useStore } from '../app/store'
import { Icon } from '../components/Icon'
import { importPhoto } from '../images/raster'
import { putImage } from '../storage/db'
import { fromUser, type PuzzleImage } from './puzzleImage'

export function UploadCard({ onImported }: { onImported: (img: PuzzleImage) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const img = await importPhoto(file)
      await putImage(img)
      void navigator.storage?.persist?.()
      await refresh()
      const meta = useStore.getState().userImages.find((u) => u.id === img.id)
      if (meta) onImported(fromUser(meta))
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : 'Something went wrong' })
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="card-wrap">
      <button className="card card-upload" onClick={() => input.current?.click()} disabled={busy} aria-busy={busy}>
        <div className="card-thumb">
          <span className="upload-icon">{busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="plus" size={24} />}</span>
          <span className="upload-hint">{busy ? 'Preparing…' : 'Stays on this device'}</span>
        </div>
        <span className="card-text">
          <span className="card-title">{busy ? 'Preparing your photo…' : 'Use your photo'}</span>
          <span className="card-sub">Make a puzzle from any picture</span>
        </span>
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
    </div>
  )
}
