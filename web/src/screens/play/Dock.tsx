import { useProfile } from '../../app/profile'
import { announce } from '../../app/rewards'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { Icon, type IconName } from '../../components/Icon'
import type { Game, ViewState } from '../../engine/Game'
import { Menu } from './Menu'

function Tool({ icon, label, text, pressed, onClick, tour }: { icon: IconName; label: string; text?: string; pressed?: boolean; onClick: () => void; tour?: string }) {
  return (
    <button className={'btn ' + (text ? 'btn-tool' : 'btn-icon')} onClick={onClick} aria-label={label} title={label} aria-pressed={pressed} data-tour={tour}>
      <Icon name={icon} />
      {text && <span className="tool-label">{text}</span>}
    </button>
  )
}

const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`

export function Dock({ game, view, previewOpen, onPreview, hasSelection }: { game: Game; view: ViewState; previewOpen: boolean; onPreview: () => void; hasSelection: boolean }) {
  const muted = useStore((s) => s.muted)
  const toggleMute = useStore((s) => s.toggleMute)
  const minimap = useSettings((s) => s.minimap)
  const setSettings = useSettings((s) => s.set)
  const zones = game.zones
  const music = useSettings((s) => s.music)
  const sorted = (kind: 'edges' | 'color' | 'tidy') => announce(useProfile.getState().recordSort(kind))

  return (
    <nav className="play-dock glass" aria-label="Puzzle tools">
      <Tool icon="bulb" label="Hint (I)" text="Hint" onClick={() => game.hint()} tour="hint" />
      <Tool icon="select" label="Select tool (S)" text="Select" pressed={view.selectMode} onClick={() => game.setView({ selectMode: !view.selectMode })} tour="select" />
      <div data-tour="sort">
        <Menu
          label="Sort pieces"
          icon="sort"
          text="Sort"
          up
          header={<p className="menu-head">Rearrange the loose pieces on the table</p>}
          items={[
            { icon: 'frame', label: 'Edges out', desc: 'Border pieces in a ring around the board', hint: '⌃⇧E', run: () => (game.sortEdgesOut(), sorted('edges')) },
            { icon: 'color', label: 'By colour', desc: 'Similar colours grouped into zones', hint: '⌃⇧C', run: () => (game.sortByColor(), sorted('color')) },
            { icon: 'grid', label: 'Tidy grid', desc: 'Line every piece up neatly, no overlaps', hint: 'T', run: () => (game.sortTidy(), sorted('tidy')) },
            { icon: 'shuffle', label: 'Scatter', desc: 'Shuffle the pieces around the table', run: () => game.sortScatter() },
            'sep',
            { icon: 'gather', label: 'Gather selection', desc: hasSelection ? 'Pull the selected pieces together' : 'Select pieces first (Select tool)', run: () => game.gatherSelection(), disabled: !hasSelection },
          ]}
        />
      </div>
      <div data-tour="view">
        <Menu
          label="View options"
          icon="layers"
          text="View"
          up
          items={[
            { icon: 'eye', label: 'Ghost image', hint: 'G', checked: view.ghost, run: () => game.setView({ ghost: !view.ghost }) },
            { icon: 'lid', label: 'Preview (box lid)', hint: 'P', checked: previewOpen, run: onPreview },
            { icon: 'frame', label: 'Edge pieces only', hint: 'E', checked: view.edgesOnly, run: () => game.setView({ edgesOnly: !view.edgesOnly }) },
            { icon: 'hidePlaced', label: 'Hide placed pieces', hint: 'H', checked: view.hidePlaced, run: () => game.setView({ hidePlaced: !view.hidePlaced }) },
            { icon: 'map', label: 'Minimap', hint: 'M', checked: minimap, run: () => setSettings({ minimap: !minimap }) },
            ...(zones
              ? [
                  'sep' as const,
                  { label: 'All colours', checked: view.zone < 0, run: () => game.setView({ zone: -1 }) },
                  ...zones.map((z) => ({
                    label: `Zone ${z.cls + 1} · ${z.count}`,
                    swatch: rgb(z.color),
                    checked: view.zone === z.cls,
                    run: () => game.setView({ zone: view.zone === z.cls ? -1 : z.cls }),
                  })),
                ]
              : []),
          ]}
        />
      </div>
      <span className="dock-sep" />
      <Tool icon="eye" label="Ghost image (G)" pressed={view.ghost} onClick={() => game.setView({ ghost: !view.ghost })} />
      <Tool icon="lid" label="Preview (P)" pressed={previewOpen} onClick={onPreview} tour="preview" />
      <Tool icon="frame" label="Edge pieces only (E)" pressed={view.edgesOnly} onClick={() => game.setView({ edgesOnly: !view.edgesOnly })} />
      <span className="dock-sep" />
      <Tool icon="zoomOut" label="Zoom out (−)" onClick={() => game.zoom(0.8)} />
      <Tool icon="fit" label="Fit (F)" onClick={() => game.fit()} />
      <Tool icon="zoomIn" label="Zoom in (+)" onClick={() => game.zoom(1.25)} />
      <span className="dock-sep" />
      <Tool icon="music" label={music ? 'Music off' : 'Calm music'} pressed={music} onClick={() => setSettings({ music: !music })} />
      <Tool icon={muted ? 'mute' : 'volume'} label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} />
    </nav>
  )
}
