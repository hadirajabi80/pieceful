# Pieceful: design notes

Product and architecture design by Claude Fable; implementation by Claude Opus. This is a condensed record of the decisions. The code is the source of truth.

## Vibe

Soft pastel stationery: rounded everything, lots of air, one accent at a time. Gradients appear only inside puzzle art, never in UI chrome.

| token | light | dark |
| --- | --- | --- |
| bg | `#FBF7F2` | `#1E1B24` |
| surface | `#FFFFFF` | `#2A2632` |
| text | `#3B3340` | `#F1EAF2` |
| accent (pink) | `#F28DA6` | `#F5A3B8` |
| mint / butter / lilac | `#8FC9C1` / `#F7C978` / `#B9A7E6` | lighter variants |
| board bg | `#EFE8E0` | `#16141B` |

- **Type:** self-hosted Nunito Variable (Latin subset precached, ~40 KB), with a rounded system fallback.
- **Radii:** 10 / 16 / 24 / pill.
- **Motion:** ease `cubic-bezier(.2,.8,.2,1)`. Durations are 120 ms for press, 200 ms for toggles and 320 ms for sheets. Only transform and opacity animate. Reduced motion disables pops, lifts and confetti.
- **Micro-interactions:**
  - Lift on pick-up (scale 1.03 and soft shadow).
  - A 90 ms glide into place on snap, then a 160 ms "pop".
  - A white flash when a piece locks to the board.
  - Confetti and a cross-fade to the clean image on completion.
- **Sound:** WebAudio blips with no audio files. They are created lazily on the first gesture, and the mute setting persists.

## UX

- **Home:** gallery cards with progress rings and ✓ chips, plus an upload card.
- **Difficulty sheet:** Breezy 12 · Cozy 24 · Snug 48 · Focused 96 · Zen 150. Each level shows Continue / Best and has a restart option.
- **Play:** a full-viewport canvas, a top-left HUD (back, timer, progress), and a bottom dock (ghost, edges-only, scatter, zoom, fit, sound, fullscreen).
  - *Implementation note:* this deviates from the single top toolbar in the plan, so phones never wrap to two rows.
- **Completion sheet:** time, moves, pieces, best time; Play again / Try next size / Home.
- **Routing:** `history.pushState` with `/` and `/play/<imageId>/<cols>x<rows>`. The Go server and the Workbox navigate fallback both serve the shell.

## Engine

- **World coordinates are board pixels.** The board is snapped to `cols·cw × rows·ch` with integer cells. A **group** has an `origin`; piece world position = `origin + cell(i)`. Grouped pieces are always correctly relative to each other, so a group is solved iff `origin = (0,0)`.
- **Shapes:**
  - Each interior edge is generated once from a seed (mulberry32): `{flip, a..e}` jitter. The pieces on both sides reference the same edge, so they interlock exactly.
  - Each edge is 3 cubic beziers through the canonical points `p0…p9`, with tab height `3t`, `t = 0.1`. The perpendicular scale is `min(cw, ch)`.
  - Bitmap margin `m = ceil(0.34·L) + 2`.
  - Smoothness across joints: the next segment's `a = -e_prev · flip_prev · flip`.
- **Grid choice:** minimise `3·|count − N|/N + |log(cellAspect)|`. For 4:3 this gives exactly 12 / 24 / 48 / 96 / 150.
- **Rendering:**
  - Pieces are pre-rendered once to canvases: clip, draw image, then an emboss and an outline stroke.
  - Each frame draws bitmaps only, and only when dirty, so the idle cost is 0.
  - Locked pieces are baked into one board-sized layer.
  - Off-screen groups are culled.
  - Smoothing quality drops when frames get heavy (>12 ms).
- **Hit testing:** groups are checked top-down in z-order; a bbox reject comes first, then `isPointInPath` on the piece's local `Path2D`.
- **Snapping:**
  - `tol = max(0.15·min(cw, ch), 14px / scale)`.
  - On drop, the group locks if it is near `(0,0)`. Otherwise it merges with any neighbouring group whose origin is within `tol`, then repeats.
  - A fully assembled group lying off-board glides home and locks.
- **Scatter:** a slot lattice around the board, filled nearest-first. Portrait viewports favour slots above and below the board; landscape favours left and right.
- **Persistence:** `SaveV1` (seed, grid, groups, z-order, moves, elapsed, toggles) goes in IndexedDB. It is debounced at 500 ms with a 2 s max wait, and flushed on hide, pagehide and leave. Shapes and bitmaps are rebuilt from the seed.

## PWA

- `registerType: 'prompt'`.
- Precache the whole app (≈380 KB, Latin font only).
- Maskable, standard and Apple icons are generated from one SVG with `sharp`.
- "Ready to play offline" and "New version ready · Refresh" toasts.
- No network calls at all after install.

## Server

- `go:embed all:dist`. Every file is read at startup with a SHA-256 ETag and a precomputed gzip variant.
- `/assets/*` → `immutable`, 1 year; everything else (shell, sw.js, manifest) → `no-cache`.
- Paths without an extension fall back to `index.html`; other missing paths return 404.
- `nosniff`, timeouts, `/healthz`.
