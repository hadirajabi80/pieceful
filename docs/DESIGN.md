# Pieceful v2 — Product + Architecture Plan

> **Implementation notes (deviations from this plan):**
> - **Artwork is self-hosted**, not hotlinked: Wikimedia rate-limits (HTTP 429). It is downloaded once by `npm run fetch-art` (with the user's approval), served as WebP from `/art/<slug>/{thumb,mid,full}.webp`, cached by Workbox (`art` cache), and embedded in the Go binary.
> - **31 images** across 5 categories, including a "Masterpieces in detail" category (Bruegel, Bosch) for 3000–5000 pieces.
> - **Snap glide** is done by tweening the dropped group's own texel, and deferring the GPU relabel and seam-join until the glide ends. The seam disappears exactly when the piece lands.
> - **Cascade merges** keep the larger group still.
> - **Guide:** the user asked for one, so there is a first-run CoachTour plus a tabbed GuideSheet.

Grounded in the v1 code at `C:\Projects\puzzle\web\src` (read: `docs/DESIGN.md`, `engine/*.ts`, `screens/*.tsx`, `styles/*.css`, `storage/db.ts`, `app/store.ts`, `vite.config.ts`). Every decision below is final unless marked "optional".

---

## 1. Architecture overview

### What stays (conceptually or verbatim)
- **World model** (`origin + cell(i)`, group solved iff origin = (0,0)) — kept; it is what makes exact snapping and seamless groups possible.
- `engine/shapes.ts` edge generation from seed (`generateEdges`, `edgePoints`, `pushEdge`, `isEdgePiece`) — kept, extended with `edgeId()` and a shared flattening routine usable from the worker.
- `engine/camera.ts` — kept, minor additions (`fitScale` padding params, `clampToContent`).
- `engine/rng.ts`, `engine/confetti.ts` (now on a 2D overlay canvas), `audio/sfx.ts` (+2 sounds), `utils/format.ts`, `components/{Sheet,Toast,Icon,ProgressRing}` (Icon gets ~20 more glyphs), `app/theme.ts`, `pwa/UpdatePrompt.tsx`, Go server (unchanged; nothing new to serve).
- zustand store + `history.pushState` routing (route gains `/play/<imageId>/<cols>x<rows>`; unchanged shape).

### What is replaced
| v1 | v2 |
| --- | --- |
| `engine/pieces.ts` per-piece OffscreenCanvas bitmaps | **Geometry worker** (`workers/geometry.worker.ts`) producing triangulated meshes + bevel strips + hit outlines + per-piece colours |
| `engine/Renderer.ts` Canvas2D | **`engine/gl/GlRenderer.ts`** WebGL2 (one image texture, static VBOs, per-group state texture, depth-tested z-order) |
| `Puzzle.ts` Map<Group> + `zOrder` array | **`Puzzle.ts` typed-array SoA** (pieceGroup / origin / z / flags), union-by-size merging, edge-join tracking, candidate-based magnetic snapping |
| `images/scenes/*` self-drawn SVGs | **`catalog/catalog.ts`** of Wikimedia Commons masterpieces/NASA, runtime-loaded, SW-cached |
| `DifficultySheet` (12–150) | **`SetupSheet`** (100–5000 + custom, grid/px info, table colour, edge-start) |
| `SaveV1` JSON piece lists | **`SaveV2`** typed-array buffers (≈85 KB for 5000 pieces) |
| HUD pill + dock | Glass top bar, dock with Sort/View menus, minimap, preview panel, selection bar, help, pause |

### Non-goals (decided)
- **Piece rotation: not in v2.** Reason: it triples the rules surface (rotation-aware snapping, hit testing, sorting, edge joins) and is punishing at 1000+ pieces with photographic images. Save format and group texture reserve a `rot` field (always 0) so v3 can add it without migration.
- **Named user trays: not in v2.** Sort-by-colour produces labelled *zones* (ephemeral chips), which covers the organising need. Persistent trays are v3.
- **Canvas2D fallback: no.** If WebGL2 is unavailable, Play shows a friendly blocker ("Pieceful needs WebGL2 — Safari 15+, Chrome 56+, Firefox 51+"). Maintaining two renderers is not worth <3% of devices. v1 renderer files are deleted.
- **Undo: not in v2.**

### Final file tree (`web/src`)
```
app/
  store.ts                      CHANGED  (+ catalog filter, continue row, settings, selection-free)
  theme.ts                      (same)
  settings.ts                   NEW      (table preset, haptics, bevel strength, persisted in localStorage)
audio/sfx.ts                    CHANGED  (+ select, sortWhoosh, error)
catalog/
  catalog.ts                    NEW      (CatalogImage[], ~24 entries curated by Opus)
  wikimedia.ts                  NEW      (thumb URL builder, width ladder, pickWidth(pieces, device))
  __tests__/catalog.test.ts     NEW      (md5 hashPath check, .jpg only, unique ids, aspect sanity)
components/
  Icon.tsx                      CHANGED  (+ select, sort, color, grid, gather, map, lid, pause, play, help, share, hidePlaced, settings, chevron)
  Sheet.tsx, Toast.tsx, ProgressRing.tsx  (same)
  Menu.tsx                      NEW      (popover menu for Sort/View, keyboard navigable)
  Slider.tsx                    NEW      (custom piece count)
  Swatches.tsx                  NEW      (table colour picker)
engine/
  types.ts                      CHANGED  (Grid, SaveV2, GeometryBuffers, flags enums)
  rng.ts, camera.ts             CHANGED  (camera: minor)
  shapes.ts                     CHANGED  (+ edgeId, flattenEdge, EDGE_PT_COUNT, shared with worker)
  layout.ts                     CHANGED  (PIECE_COUNTS, chooseGrid cap, scatter kept; + packShelves, edgesOutLayout, tidyLayout, gatherLayout, zoneLayout)
  color.ts                      NEW      (srgb→OKLab, kmeans++, zone count rule)
  Puzzle.ts                     CHANGED  (rewritten SoA; see §4)
  Selection.ts                  NEW      (Set<groupId>, marquee capture, move/drop semantics)
  Input.ts                      CHANGED  (modes: drag, dragSelection, pan, pinch, marquee; space-pan; right/middle)
  Keys.ts                       NEW      (keyboard shortcut map → Game commands)
  Game.ts                       CHANGED  (facade; loader pipeline; sort commands; pause; save v2; events)
  animation.ts                  NEW      (GroupTween list: glide/pop/flash, writes group texture mirror)
  confetti.ts                   (same; drawn on overlay canvas)
  gl/
    GlRenderer.ts               NEW      (context, passes, resize/DPR, context loss)
    programs.ts                 NEW      (compile/link helpers, uniform cache)
    shaders/pieces.vert.glsl    NEW
    shaders/pieces.frag.glsl    NEW      (u_mode: 0 fill, 1 bevel, 2 shadow, 3 glow, 4 flash)
    shaders/background.frag.glsl NEW
    shaders/quad.vert.glsl / quad.frag.glsl  NEW  (ghost/reveal image quad, fullscreen tri)
    StateTextures.ts            NEW      (group RGBA32F, pieceGroup R32UI, pieceFlags R8UI, edgeJoined R8UI mirrors + dirty ranges)
    Buffers.ts                  NEW      (static VBO/IBO upload, dynamic "effects" IBOs: lifted, selected, target, flash, visible)
  minimap.ts                    NEW      (2D canvas: board, group rects coloured by avg colour, viewport rect; throttled)
  __tests__/
    puzzle.test.ts              CHANGED  (snapping candidates, union-by-size, edge joins, lock-merge)
    layout.test.ts              CHANGED  (+ packShelves/edgesOut/tidy non-overlap tests)
    shapes.test.ts              CHANGED  (+ shared edge points identical both sides)
    color.test.ts               NEW
    save.test.ts                NEW      (v2 round trip, v1 purge)
workers/
  geometry.worker.ts            NEW      (flatten → earcut → strips → colours; transferables; progress)
images/
  raster.ts                     CHANGED  (MAX_SIDE 3840, thumb 640; loadWithProgress)
  loader.ts                     NEW      (fetch with progress → ImageBitmap; catalog vs user; resolution choice)
  svgkit.ts, scenes/*           DELETED
screens/
  Home.tsx                      CHANGED  (hero, continue row, category tabs, grid, credits footer)
  HeroCard.tsx                  NEW
  ContinueRow.tsx               NEW
  PuzzleCard.tsx                CHANGED  (artist/year line, offline badge, chips)
  UploadCard.tsx                CHANGED  (3840 import)
  SetupSheet.tsx                NEW      (replaces DifficultySheet.tsx — DELETED)
  CreditsSheet.tsx              NEW
  Play.tsx                      CHANGED  (GL canvas + overlay canvas + DOM layers)
  play/TopBar.tsx               NEW
  play/Dock.tsx                 NEW      (replaces PlayToolbar.tsx — DELETED)
  play/Minimap.tsx              NEW
  play/PreviewPanel.tsx         NEW      (box lid)
  play/SelectionBar.tsx         NEW
  play/ZoneChips.tsx            NEW
  play/Marquee.tsx              NEW
  play/HelpSheet.tsx            NEW
  play/SettingsSheet.tsx        NEW
  play/PauseOverlay.tsx         NEW
  play/LoadingOverlay.tsx       NEW
  play/Blocker.tsx              NEW      (no WebGL2)
  CompleteModal.tsx             CHANGED  (title/artist, stats, share)
storage/db.ts                   CHANGED  (SaveV2, purge v1, image cache badge helper)
styles/tokens.css               CHANGED  (§5 tokens)
styles/global.css               CHANGED  (glass chrome, new screens)
pwa/UpdatePrompt.tsx            (same)
main.tsx, App.tsx               CHANGED  (route key, settings init)
vite.config.ts                  CHANGED  (runtimeCaching, worker format es)
package.json                    CHANGED  (+ earcut, @types/earcut)
docs/DESIGN.md                  CHANGED  (v2 record)
```

---

## 2. WebGL2 renderer spec (`engine/gl/`)

### Context
`canvas.getContext('webgl2', { alpha:false, antialias:true, depth:true, stencil:false, premultipliedAlpha:false, preserveDrawingBuffer:false, powerPreference:'high-performance' })`. If null → `Blocker`. Query `MAX_TEXTURE_SIZE`; enable `EXT_texture_filter_anisotropic` if present (aniso 4). `OES_texture_float_linear` not needed (texelFetch only).

A second, DOM-stacked `<canvas class="fx">` (2D, pointer-events none) holds confetti only.

### Coordinate chain
`world (board px) → screen css px (× cam.scale + cam.t) → NDC`. Uniforms: `u_cam = vec3(scale, tx, ty)`, `u_view = vec2(cssW, cssH)`. Backing store = css × dpr, `dpr = min(devicePixelRatio, 2)` (adaptive: drop to 1.5 after 10 frames > 20 ms, restore after 60 fast frames). `gl.viewport(0,0,W*dpr,H*dpr)`. ResizeObserver → resize; camera keeps the centre world point.

### Static geometry (uploaded once per puzzle from worker output)
Fill VBO (interleaved, stride 12): `a_pos: vec2 f32` (board space = solved position, includes tabs), `a_piece: u16` (+u16 pad). Fill IBO `u32`, piece `i` occupies `[fillStart[i], fillStart[i+1])`.

Strip VBO (stride 24): `a_pos vec2 f32`, `a_norm vec2 f32` (outward unit normal, mitered), `a_piece u16`, `a_edge u16` (shared edge id; `0xFFFF` = board border), `a_t u8 normalized` (0 at outline, 1 at inner end) + 3 pad. Strip IBO `u32`, ranges `stripStart[i]`.

UV is derived: `v_uv = a_pos / u_board`. The texture is the raw image (not resampled); the ≤ cols/2 px stretch between image size and `cols·cw` is invisible.

### Dynamic state textures (`StateTextures.ts`) — all `TEX_W = 256` wide
| name | format | index | content | updated |
| --- | --- | --- | --- | --- |
| `u_groups` | RGBA32F | group id | `(ox, oy, z, flags)`; flags as float-encoded uint (exact < 2^24) | drag: 1 texel; animations: dirty row range; renumber: all |
| `u_pieceGroup` | R32UI | piece | group id | merge: pieces of the smaller group |
| `u_pieceFlags` | R8UI | piece | bit0 isEdge, bits1–4 colorClass+1 (0 = none) | sort by colour |
| `u_edgeJoined` | R8UI | edge id | 1 when both sides are in the same group | merge/lock |

Group flags bits: `LOCKED=1, LIFTED=2, SELECTED=4, TARGET=8, HIDDEN=16`. CPU mirrors are typed arrays; `texSubImage2D` on the dirty row range `[floor(lo/256), ceil(hi/256))` once per frame.

Why piece→group indirection instead of per-piece offsets: dragging a 3000-piece group = **one** texel write; merging = O(smaller group) relabels (union by size ⇒ O(n log n) total). Per-piece offsets would also work but make every drag O(group).

### Depth / z-order
`z[g]` is a monotonically increasing counter (`++zCounter` on pick-up and merge); locked = 0 (farthest). Vertex: `gl_Position.z = 1.0 - 2.0 * z / Z_MAX`, `Z_MAX = 2^20`; when `zCounter > Z_MAX - 4`, renumber loose groups by sorted z (O(n log n), rare) and re-upload the group texture. Lifted group gets `z = Z_MAX - 2` for the duration; shadow uses `Z_MAX - 3`. 24-bit depth gives 16× margin per step. No CPU sorting ever.

### Passes per frame (only when dirty/animating; idle = zero work)
1. `clearColor(table)`, clear depth. Depth test on, `LEQUAL`.
2. **Background** (depth test off): fullscreen triangle, `background.frag` (felt + grain + vignette + board slot SDF + 2 px outline).
3. **Ghost / reveal** (depth off, blend): textured quad over board rect with `u_alpha` (ghost 0.22; completion cross-fade 0→1 over 700 ms).
4. **Fill** (depth write on): `pieces.vert` + `pieces.frag u_mode=0`, full static IBO (or the *visible IBO*, §7).
5. **Bevel strip** (`u_mode=1`, depth LEQUAL, write on): skipped entirely if `bevelPx = bevelW·scale < 0.6`.
6. **Shadow** (`u_mode=2`, depth test on, write off, blend src-alpha): lifted IBO, fill + strip with `u_stripW = -10/scale` (outward), offset `u_shadowOff = (6,9)/scale`, depth `Z_MAX-3`, alpha 0.28·(1-t). Only while a lift is active.
7. **Glow** (`u_mode=3`): selected IBO (accent, outward 2.5/scale), then target IBO (snap candidate: mint, outward 3/scale, pulsing alpha 0.5–0.9 at 1.6 Hz). Depth test on, write off.
8. **Flash** (`u_mode=4`): flash IBO (just-locked/merged pieces), white alpha `0.55·(1-t)`, 260 ms.
9. Confetti on the 2D overlay canvas (existing `Confetti`).

Lifted scale pop (`1.03` about the grab pivot) is applied in the vertex shader for groups with `LIFTED`.

### Shaders

`pieces.vert.glsl`
```glsl
#version 300 es
precision highp float; precision highp int; precision highp usampler2D;
layout(location=0) in vec2 a_pos;
layout(location=1) in uint a_piece;
layout(location=2) in vec2 a_norm;     // strip only (fill binds a zero constant)
layout(location=3) in uint a_edge;     // strip only
layout(location=4) in float a_t;       // strip only (u8 normalized)
uniform vec3  u_cam;      // scale, tx, ty
uniform vec2  u_view;     // css px
uniform vec2  u_board;    // W, H
uniform float u_zMax;
uniform float u_stripW;   // world px; >0 inward (bevel), <0 outward (shadow/glow)
uniform vec2  u_offset;   // world px extra offset (shadow)
uniform float u_zOverride;// <0 = use group z, else fixed (shadow/glow/flash)
uniform vec4  u_lift;     // pivot.xy, scale, enabled
uniform uint  u_hideMask; // group flags that hide (HIDDEN | optionally LOCKED when hidePlaced)
uniform sampler2D  u_groups;      // RGBA32F
uniform usampler2D u_pieceGroup;  // R32UI
uniform usampler2D u_pieceFlags;  // R8UI
uniform usampler2D u_edgeJoined;  // R8UI
out vec2 v_uv; out float v_t; out float v_shade;
flat out uint v_pflags; flat out uint v_gflags; flat out float v_joined;
const int TEX_W = 256;
ivec2 tc(uint i) { return ivec2(int(i) & 255, int(i) >> 8); }
void main() {
  uint gid   = texelFetch(u_pieceGroup, tc(a_piece), 0).r;
  vec4 g     = texelFetch(u_groups, tc(gid), 0);
  uint gfl   = uint(g.w + 0.5);
  v_pflags   = texelFetch(u_pieceFlags, tc(a_piece), 0).r;
  v_gflags   = gfl;
  v_joined   = a_edge == 0xFFFFu ? 0.0 : float(texelFetch(u_edgeJoined, tc(a_edge), 0).r);
  vec2 local = a_pos - a_norm * (a_t * u_stripW);
  vec2 world = local + g.xy + u_offset;
  if ((gfl & 2u) != 0u && u_lift.w > 0.5) world = u_lift.xy + (world - u_lift.xy) * u_lift.z;
  vec2 scr = world * u_cam.x + u_cam.yz;
  vec2 ndc = vec2(scr.x / u_view.x * 2.0 - 1.0, 1.0 - scr.y / u_view.y * 2.0);
  float z  = u_zOverride < 0.0 ? g.z : u_zOverride;
  float depth = 1.0 - 2.0 * (z / u_zMax);
  bool hidden = (gfl & u_hideMask) != 0u;
  gl_Position = hidden ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(ndc, depth, 1.0);
  v_uv = a_pos / u_board; v_t = a_t;
  v_shade = dot(a_norm, normalize(vec2(-1.0, -1.0)));   // +1 lit (top-left), -1 shaded
}
```

`pieces.frag.glsl`
```glsl
#version 300 es
precision highp float; precision highp int;
in vec2 v_uv; in float v_t; in float v_shade; flat in uint v_pflags; flat in uint v_gflags; flat in float v_joined;
uniform sampler2D u_image;
uniform int   u_mode;        // 0 fill, 1 bevel, 2 shadow, 3 glow, 4 flash
uniform vec3  u_table;       // for dimming
uniform vec3  u_accent;      // selection tint / glow colour (set per glow draw)
uniform float u_bevelPx;     // bevel width on screen, for fade-in
uniform float u_bevelStrength; // 0.6..1.2 user setting
uniform float u_dimEdges;    // 1 when edges-only
uniform int   u_zone;        // -1 none, else colorClass to keep
uniform float u_alpha;       // effect alpha (shadow/glow/flash)
out vec4 o;
float dimFactor() {
  if ((v_gflags & 1u) != 0u) return 0.0;                      // locked never dimmed
  bool isEdge = (v_pflags & 1u) != 0u;
  int cls = int(v_pflags >> 1) - 1;
  float d = 0.0;
  if (u_dimEdges > 0.5 && !isEdge) d = 0.85;
  if (u_zone >= 0 && cls != u_zone) d = 0.85;
  return d;
}
void main() {
  if (u_mode == 2) { o = vec4(0.06, 0.03, 0.08, u_alpha * (1.0 - v_t)); return; }
  if (u_mode == 3) { if (v_joined > 0.5) discard; o = vec4(u_accent, u_alpha * (1.0 - v_t)); return; }
  if (u_mode == 4) { o = vec4(1.0, 1.0, 1.0, u_alpha); return; }
  vec3 c = texture(u_image, v_uv).rgb;
  if (u_mode == 1) {
    if (v_joined > 0.5) discard;                              // merged seam: nothing drawn → seamless
    float k = 1.0 - v_t;  k *= k;                             // falloff toward inside
    float light = v_shade * 0.42 * u_bevelStrength * k;
    c = c * (1.0 + light) + max(light, 0.0) * 0.22;           // lit edges add white; shaded multiply
    float line = 1.0 - smoothstep(0.16, 0.30, v_t);           // thin dark outline ~22% of strip
    c = mix(c, c * 0.42, line * 0.85);
    float fade = clamp((u_bevelPx - 0.6) / 1.2, 0.0, 1.0);
    c = mix(texture(u_image, v_uv).rgb, c, fade);
  }
  c = mix(c, u_table, dimFactor());                           // opaque dim (no blending order issues)
  if ((v_gflags & 4u) != 0u) c = mix(c, u_accent, 0.10);      // selected tint
  o = vec4(c, 1.0);
}
```

`background.frag.glsl`
```glsl
#version 300 es
precision highp float;
uniform vec2 u_view; uniform float u_dpr; uniform vec3 u_cam;
uniform vec3 u_table, u_slot, u_line;   // preset colours
uniform vec2 u_board;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
void main(){
  vec2 px = gl_FragCoord.xy / u_dpr; px.y = u_view.y - px.y;        // css px, y down
  vec2 wp = (px - u_cam.yz);                                          // pan-locked grain
  float n = hash(floor(wp)) * 0.55 + hash(floor(wp * 0.5)) * 0.45;
  vec3 c = u_table * (0.95 + 0.10 * n);
  vec2 q = px / u_view - 0.5; c *= 1.0 - 0.22 * dot(q, q);           // vignette
  vec2 bc = (u_board * 0.5) * u_cam.x + u_cam.yz;                     // board centre on screen
  float d = sdBox(px - bc, u_board * 0.5 * u_cam.x) - 6.0;            // rounded 6 px
  float inside = 1.0 - smoothstep(-0.8, 0.8, d);
  c = mix(c, u_slot, inside * 0.9);
  float ring = 1.0 - smoothstep(0.0, 1.6, abs(d + 1.0) - 0.6);
  c = mix(c, u_line, ring * 0.55);
  o = vec4(c, 1.0);
}
```

`quad.vert/frag`: board-rect textured quad (`u_rect` world, `u_alpha`), used for ghost and completion reveal.

### Seamless merged groups (hard requirement)
1. **Shared vertices**: each interior edge is flattened **once** in the worker (`flattenEdge`) and the resulting points are reused by both pieces (reversed for the second). Both pieces of a group get the same `g.xy` offset, so transformed positions are bit-identical ⇒ rasterisation is watertight; no hairline from MSAA either.
2. **No bevel/outline on internal seams**: strip quads carry `a_edge`; `u_edgeJoined[edge] = 1` after merge/lock ⇒ `discard` in bevel/glow modes; the fill triangles underneath show the continuous image. Border edges (`0xFFFF`) always render.
3. UV is continuous across pieces (board-space), so the image is continuous as well.
4. Texture sampling uses `LINEAR_MIPMAP_LINEAR` with a mip bias of −0.25 to keep seams crisp when zoomed out.

### Picking: CPU, no spatial grid (decision)
GPU readPixels forces a pipeline sync (10–30 ms on mobile) and requires an id pass; CPU hit testing is O(#groups) and sub-millisecond:
```
hitTest(p):
  best = null; bestZ = -1
  for g in loose groups (≤ n):
    lx = p.x - ox[g]; ly = p.y - oy[g]
    if outside bbox[g] ± margin → continue
    col = floor(lx / cw), row = floor(ly / ch)
    for (dc,dr) in [(0,0),(1,0),(-1,0),(0,1),(0,-1)]:       // tabs reach only into 4-neighbours
      i = index(col+dc, row+dr); if invalid or pieceGroup[i] != g → continue
      if pointInPolygon(outline(i), lx - cellX(i), ly - cellY(i)) and z[g] > bestZ → best = g, bestZ = z[g]
  return best
```
Respects dim/hidden filters (dimmed groups are not pickable). Marquee capture is an O(n) pass over piece cell centres.

### Context loss / fallbacks
- `webglcontextlost` → `preventDefault()`, stop rAF, show toast "Graphics paused…". `webglcontextrestored` → recreate programs, re-upload static buffers from retained CPU arrays (they stay in memory: ≈ 20 MB for 5000 pieces), re-upload state textures from mirrors, re-fetch the image from the SW cache (fast) and re-upload. Game state is untouched.
- On leaving Play: delete buffers/textures, `WEBGL_lose_context.loseContext()`, terminate worker, drop typed arrays, `close()` the ImageBitmap.
- `antialias:true` is best-effort; if `gl.getContextAttributes().antialias` is false we widen the outline by 0.5 px to hide aliasing.

---

## 3. Geometry / worker pipeline (`workers/geometry.worker.ts`)

Request: `{ type:'cut', seed, cols, rows, cw, ch, quality:'high'|'mobile', colorBitmap?: ImageBitmap }` (bitmap transferred, pre-resized on main thread to `cols*4 × rows*4` via `createImageBitmap(blob, {resizeWidth, resizeHeight, resizeQuality:'medium'})`).

Steps:
1. `generateEdges(seed, cols, rows)` (shared code from `shapes.ts`).
2. **Flatten each interior edge once**: `n = clamp(ceil(L / 8), 4, 16)` samples per cubic (`L = min(cw,ch)`; mobile: `clamp(ceil(L/10), 3, 12)`), uniform-t sampling (curvature is mild; adaptive not needed). Edge polyline = 3n+1 points in board space. Border edges = 2 points. Store in `edgePts[edgeId]`.
3. **Per piece outline** = concat of top (forward), right (forward), bottom (reversed), left (reversed) polylines without duplicating joints. Write to `outlinePts` (piece-local, relative to cell top-left; used for CPU hit tests) and board-space to the fill VBO.
4. **earcut** (`earcut(flat, null, 2)`) → fill indices, offset by the piece's vertex base. Typical 5000-piece puzzle: ~60–74 points/piece.
5. **Bevel strip**: for each outline vertex `k`: `n_k = normalize(n_prev + n_next)` where `n_prev/n_next` are outward segment normals; miter clamp `n_k /= max(0.5, dot(n_k, n_prev))`. Emit two vertices (outer `t=0`, inner `t=1`, same `a_pos`, `a_norm = n_k`, `a_edge` = edge the vertex belongs to; joints take the next edge's id). Indices: 2 triangles per outline segment (closed loop). Bevel width is **not** baked (it is `u_stripW`): `bevelW = clamp(0.07·L, 1.5, 7)` world px set by the renderer; shadow/glow reuse the strip with negative width.
6. **Per-piece colour**: `OffscreenCanvas(cols*4, rows*4)` → `getImageData`; average the 4×4 block per piece in linear RGB → OKLab → `avgLab: Float32Array(3n)`. (If `OffscreenCanvas` is missing in the worker — old Safari — main thread computes it after.)
7. Progress message every 250 pieces: `{type:'progress', done, total}`.
8. `postMessage({type:'done', geo}, transferables)`.

`GeometryBuffers` (all transferable):
```ts
interface GeometryBuffers {
  n: number; edgeCount: number
  outlinePts: Float32Array; outlineStart: Uint32Array        // n+1 prefix (points)
  fillVBO: ArrayBuffer; fillIdx: Uint32Array; fillStart: Uint32Array   // n+1 prefix (indices)
  stripVBO: ArrayBuffer; stripIdx: Uint32Array; stripStart: Uint32Array
  avgLab: Float32Array | null
  stats: { verts: number; tris: number; ms: number }
}
```
Sizes for 5000 pieces (≈ 68 pts/piece): fill VBO 4.1 MB, fill IBO 4 MB, strip VBO 16 MB, strip IBO 3.3 MB, outlines 2.7 MB ⇒ ≈ 30 MB CPU, ≈ 27 MB GPU. Index counts ≈ 1.0 M (fill) + 0.8 M (strip).

Timing budget (5000 pieces): worker ≤ 1.2 s desktop / ≤ 3.5 s mid phone (flatten+earcut ≈ 60 µs/piece, strips ≈ 15 µs/piece, colour ≈ 100 ms). Main thread after `done`: buffer upload ≤ 40 ms, texture upload + `generateMipmap` 3840×2880 ≈ 60–150 ms (accepted one-time hitch, done while the loader overlay still shows "Preparing table").

Edge id scheme (shared `shapes.edgeId`): horizontal `h[r][c]` (r ∈ 1..rows-1) → `(r-1)*cols + c`; vertical `v[c][r]` (c ∈ 1..cols-1) → `(rows-1)*cols + (c-1)*rows + r`. `edgeCount = (rows-1)*cols + (cols-1)*rows`.

---

## 4. Rules & data scaling (`engine/Puzzle.ts`)

### Representation (SoA, n = cols·rows, group id ∈ [0,n) = id of some member piece)
```ts
pieceGroup: Int32Array(n)          // piece → group id
members: Map<number, number[]>     // group id → piece list (only heads)
ox, oy: Float64Array(n)            // origin per group id
z: Uint32Array(n)                  // 0 = locked
gflags: Uint8Array(n)              // LOCKED|LIFTED|SELECTED|TARGET|HIDDEN (mirrors renderer flags)
bbox: Int32Array(4n)               // local cell bbox per group
hasEdge: Uint8Array(n)
edgeJoined: Uint8Array(edgeCount)
loose: Set<number>                 // loose group ids
boardGroup = -1                    // id of the single locked group once anything is locked
zCounter, placed, moves, completed
listeners: onGroup(gid), onRelabel(gid, pieces), onEdgeJoin(edgeIds[]), onFlags(gid)
```
`looseGroups()` iterates `loose`. No z-order array.

### Merge (union by size)
```
merge(g, h):                      // h = stationary group (origin adopted)
  s = larger(g,h); o = other
  for p in members[o]: pieceGroup[p] = s
      for q in neighbors4(p): if pieceGroup[q] == s: edgeJoined[edgeBetween(p,q)] = 1; joined.push(...)
  members[s].push(...members[o]); delete members[o]
  ox[s] = ox[h]; oy[s] = oy[h]     // exact copy — snapped origins are bit-equal
  bbox[s] = union; hasEdge[s] |= hasEdge[o]; z[s] = ++zCounter
  loose.delete(o); emit onRelabel(s, members[o]), onEdgeJoin(joined), onGroup(s)
  return s
```
Cost O(|o|) per merge ⇒ O(n log n) over a whole game; a 3000+2000 merge relabels 2000 pieces (< 1 ms).

### Lock
`lock(g)`: if `boardGroup < 0` → `boardGroup = g`, `locked = 1`, origin (0,0), z = 0, remove from loose; else `merge(g, boardGroup)` (same O(|smaller|) path; joins happen naturally). `placed = members[boardGroup].length`. Completion when `placed == n`.

### Magnetic snapping (dedicated spec)
- **Tolerance** (world px): `tol = clamp(max(0.28·L, 18/scale), 0, 0.45·L)`, `L = min(cw,ch)`. 28 % of a cell is generous but cannot reach the wrong neighbour (centres are 1·L apart); the screen-px floor keeps it usable when zoomed out; the 45 % cap prevents false snaps at extreme zoom-out.
- **Candidates** (all of them, then pick the closest):
  ```
  candidates(g):
    out = []
    if hasEdge[g] or members[g].length >= 4:            // any group may lock; cheap
        out.push({kind:'board', d: hypot(ox[g], oy[g]), target:-1})
    for p in members[g]:                                 // O(|g|); 3000-piece group ≈ 12k lookups
      for q in neighbors4(p):
        h = pieceGroup[q]; if h == g or locked[h]: continue
        d = hypot(ox[h]-ox[g], oy[h]-oy[g])
        out.push({kind:'group', d, target:h})            // dedupe by h keeping min d (Map)
    return out sorted by d
  ```
  Locked neighbours are covered by the `board` candidate (their origin is (0,0)).
- **Drop** → `drop(g, from, scale)`:
  ```
  moved = dist(origin, from) > 0.5; if moved: moves++
  loop:
    c = min-d candidate; if !c or c.d > tol: break
    if c.kind == 'board': lock(g); result.locked = true; break
    g = merge(g, c.target); result.merged = true          // origin copied exactly → next pass finds d == 0 for other touching neighbours
  if !locked and members[g].length == n: lockFrom = origin; lock(g)
  ```
  Repeat picks up cascades (a piece dropped into a gap between two groups joins both).
- **Exactness**: origins are `Float64`; snapping assigns `ox[s] = ox[h]` (no arithmetic). Loose drops round the origin to **0.25 px** (`Math.round(v*4)/4`) so float32 conversion in the texture is exact and pieces never land on sub-pixel positions that shimmer.
- **Hover preview while held** (decided: yes, preview only — no auto-snap while held, which fights the user): on every drag move, compute the closest candidate for the dragged group (same function, cheap); if `d ≤ tol` set `TARGET` flag on that group (or on the board: board outline glows) → mint glow pulse + the dragged group's shadow shortens (`u_shadowOff·0.5`) to "feel" the pull. Clear when leaving tolerance. Throttled to one check per animation frame.
- **Feedback on snap**: glide 110 ms ease-out from drop position to the exact origin (group tween writes interpolated offset to the texel; final frame writes the exact origin), then pop (scale 1.05 over 160 ms via the lift matrix), `sfx.snap()` (merge) / `sfx.lock()` (board), `navigator.vibrate(8 | 12)`, white flash 260 ms on the joined seam pieces. No snap → `sfx.drop()`.

### Multi-selection semantics (`Selection.ts`)
- `selected: Set<groupId>`; marquee captures pieces whose **cell centre** is inside the rectangle (world space) → adds their **whole groups**; locked groups never selectable; dimmed (filtered) groups not selectable.
- Drag on a selected group moves every selected group by the same delta (one texel write each per frame — 500 selected groups = 8 KB upload, fine). Drop runs `drop()` for the grabbed group first, then for each other selected group (cheap); merges that absorb a selected group remove it from the set. Selected set is cleared after a drop that merged/locked the grabbed group? **No** — selection persists until Esc/empty-click so the user can keep arranging.
- `selectAllLoose()`, `invert()` not provided (keep minimal), `clear()`.
- Selected groups render with tint + accent glow; `LIFTED` applies to all selected while dragging.

### Sorting algorithms (`layout.ts`, pure, tested)
Common primitive — shelf packing of rectangles into a region:
```
packShelves(items: {id, w, h}[], region: Rect, gap): Map<id, Vec>
  sort items by h desc (stable); x = region.x0; y = region.y0; shelfH = 0
  for it: if x + it.w > region.x1 and x > region.x0: x = region.x0; y += shelfH + gap; shelfH = 0
          place (x, y); x += it.w + gap; shelfH = max(shelfH, it.h)
  return placements (region may overflow downward; caller extends content bounds)
```
Item size = group bbox size + 2·tab (`tab = m-2`); placement is top-left, origin = placement − bbox.min + tab.

Side bands around the board (`bands(board, pad, viewportAspect)`): four rects: `top` (above board, full width incl. corners), `bottom`, `left`, `right`, each `depth` deep; preference order landscape `[left,right,top,bottom]`, portrait `[top,bottom,left,right]`. `fillBands(items, bands, gap)` fills bands in order, growing the band depth by one row/column when full.

1. **Edges out**: `edgeGroups = loose with hasEdge`, `interior = rest`. Place edge groups in a tight ring: `ring = bands(board, gap=0.4L, depth = 1 item)` filled in random order (shuffled with the game rng; not sorted by side — would be a solver); when the ring is full, add a second ring. Interior groups: `packShelves` into bands *outside* the rings. Result applied with `moveGroups(map, 420 ms)`.
2. **Sort by colour**: `k = n ≤ 150 ? 3 : n ≤ 500 ? 4 : n ≤ 1000 ? 5 : n ≤ 3000 ? 6 : 8`. Points = per-group mean of `avgLab` of members (loose only). `kmeans(points, k, iters=20, init=kmeans++ with seeded rng)` in OKLab with L weighted 0.7. Assign `colorClass` per piece (class of its group). Zones: `k` rects laid around the board (order: top, bottom, left, right, then corners; each zone's area ∝ member count); inside each zone `packShelves` with items sorted by L. Zone label chips show the centroid colour swatch + count. Upload `pieceFlags`.
3. **Tidy grid**: all loose groups → `fillBands` with `gap = 0.25L`, items sorted by h desc (multi-piece groups first so they sit nearest the board). No overlap by construction.
4. **Scatter**: v1 `scatter()` kept (slot lattice, random), bounds extended to fit.
5. **Gather selection**: `packShelves(selected, region centred at P with width = sqrt(totalArea)·1.3)`; P = pointer position if the command came from the context/selection bar on desktop, else viewport centre. Pieces sit on top (z bumped).
All five produce `Map<groupId, Vec>`; `Game.moveGroups(map, ms)` tweens origins (group texture upload of the dirty range each frame), updates content bounds once, fits the camera if the result is outside the view, and increments `moves` by 1.

### Camera / content bounds
`content = union(board, all loose world bboxes) + 0.5·cell padding`; recomputed after every drop/sort (O(n)) — not per frame. `minScale = fitScale(content)·0.5`; `maxScale = 420 / L` (a piece fills ~420 px). `clamp()` as v1 (80 px of content must stay on screen). Table for 5000 pieces at 3840 px ≈ 12 000 × 9 000 world px — float32 is fine (precision 0.001 px).

---

## 5. UX spec

### Visual language (tokens, `tokens.css`)
Premium, neutral surfaces; the pastel brand survives in the accent, the icon and illustrations, not in chrome.
```
light: --bg #F6F4F1  --surface #FFFFFF  --surface-2 #EFECE8  --surface-glass rgb(255 255 255 / .72)
       --border #E3DED8  --border-strong #CFC8C0  --text #221F26  --text-2 #5C5661  --text-muted #8A8390
       --accent #E26A8A (brand pink, deeper)  --accent-soft #F8DCE4  --mint #3FA796  --mint-soft #D9F1EC
       --amber #D99A2B  --lilac #8A74D6  --danger #D45A5A  --on-accent #FFFFFF  --shadow-rgb 30 20 35
dark:  --bg #121216  --surface #1B1B21  --surface-2 #24242C  --surface-glass rgb(27 27 33 / .70)
       --border #2F2F38  --border-strong #42424D  --text #F2EFF4  --text-2 #B9B3C0  --text-muted #847E8C
       --accent #F08AA6  --accent-soft #3A2530  --mint #5FC4B3 ... --shadow-rgb 0 0 0
radii: --r-xs 8  --r-sm 12  --r-md 16  --r-lg 20  --r-pill 999
type (Nunito Variable kept): --fs-xs 12 --fs-sm 13 --fs-md 15 --fs-lg 17 --fs-xl 22 --fs-2xl 28 --fs-3xl 36; weights 600 body, 700 labels, 800 titles; letter-spacing -0.015em on titles; tabular-nums for stats.
glass: background var(--surface-glass); backdrop-filter blur(18px) saturate(1.5); border 1px solid rgb(255 255 255 / .45) (dark: rgb(255 255 255 / .08)); box-shadow 0 8px 28px -10px rgb(var(--shadow-rgb)/.30)
motion: unchanged easings; durations 120/200/320; reduced motion respected.
table presets (name → table, slot, line):
  linen    #E9E2D6 / #DFD6C8 / #B9AE9F   (light default)
  slate    #3A3F4B / #30343E / #5B6170   (dark default)
  felt     #2F5D4A / #27503F / #4E8068
  walnut   #5A4034 / #4C352B / #7D5B4B
  charcoal #1F2126 / #191B1F / #3A3D44
  navy     #243249 / #1D293D / #3D5070
```
Icons: 20 px, stroke 1.75, round caps (existing `Icon` style).

### Home (`Home.tsx`)
- Top bar: brand (icon + "Pieceful"), right: theme, sound, settings (gear → SettingsSheet).
- **Hero**: featured catalog image (first `featured` without a completed record, else rotate daily by date hash), 16:9 crop, bottom gradient scrim, title (fs-2xl), "artist · year", primary button "Play" (opens SetupSheet), secondary "Details" (credit). If a save exists: progress bar + "Continue · 1000 pieces · 34 %".
- **Continue row** (only if saves exist): horizontal scroll of cards 180 px: thumb, title, "1000 pcs", progress bar, elapsed; tap → Play directly; long-press/⋯ → restart/delete.
- **Category tabs** (chips, scrollable): All · Paintings · Japanese prints · Space · Landscapes · My photos. Store filter in zustand (not URL).
- **Grid**: `minmax(180px,1fr)`; card = thumb (object-fit cover, 4:3 frame, `loading=lazy`, 500 px thumb; 960 px on dpr ≥ 2), title (700), "artist · year" (muted, fs-sm), chips: in-progress (ring + "1000 · 34 %"), done (check + "500"), "Offline" cloud-check badge when `caches.match` finds the play-size URL. Upload card first inside "My photos" and "All".
- Footer: "Artwork from Wikimedia Commons — public domain and NASA imagery." link → **CreditsSheet** (list: title, artist, year, licence, link to the Commons page).

### SetupSheet (replaces DifficultySheet)
- Head: thumb, title, artist · year, small "credit ↗".
- **Piece count**: segmented chips `100 300 500 1000 2000 3000 5000` + "Custom" revealing a slider 50–5000 (step 10, detents at the presets). Under it, live detail line: "82 × 61 grid · 5002 pieces · piece ≈ 47 px · image 3840 px". Per chip: "Continue 34 %" / "Best 12:40" / nothing.
- Mobile (`deviceMemory ≤ 4` or `maxTouchPoints > 0 && width < 900`) shows an amber note for ≥ 2000: "Large puzzles may be slower on this device."
- Toggles: "Start with edges sorted" (edge-start), table colour swatches (6 presets, persisted default).
- Buttons: "Start puzzle" (or "Continue" + "Start over" if a save exists).

### Loading overlay (Play)
Stages with a single progress bar: "Downloading image · 2.3 / 5.5 MB" (fetch stream) → "Cutting 5000 pieces · 64 %" (worker progress) → "Preparing table". Cancel = back. Image shows as a blurred backdrop once downloaded.

### Play layout
- **Top bar** (glass pill, top-left → stretches): `[← Back] [Title · 1000 pcs]` … centre `[Progress 34 % ▰▰▰▱]` … right `[12:34 ⏸] [⋯]`. ⋯ menu: Settings, Help & shortcuts, Restart, Home. On phones the title is hidden and progress becomes a thin bar under the pill.
- **Dock** (glass, bottom centre, horizontally scrollable on phones): `Select(S)` · `Ghost(G)` · `Preview(P)` · `Edges(E)` · `Sort ▾` · `View ▾` · │ · `−` `Fit(F)` `+` · │ · `Sound` · `Fullscreen`.
  - Sort ▾: Edges out · By colour · Tidy grid · Scatter · Gather selection (disabled if none).
  - View ▾: Hide placed pieces (H) · Edge pieces only (E) · Colour zone: All / 1..k · Minimap (M) · Table colour…
- **Minimap** (`Minimap.tsx`): bottom-right 180×(table aspect) glass panel; 2D canvas draws table bounds, board rect, every loose group bbox as a 2 px rect in its avg colour (5000 rects ≈ 1 ms, throttled to 150 ms after changes), viewport rect (accent outline). Tap/drag → centre camera there. Auto-shown for ≥ 500 pieces on screens ≥ 900 px; toggle M.
- **Preview panel** (`PreviewPanel.tsx`): floating glass window with the full image (1280 thumb), default 260 px wide top-right under the top bar, draggable by its header, resizable by a corner handle (min 160, max 60 vw), double-tap header → cycle sizes (S/M/L). On phones default width 50 vw. Pinch inside zooms the preview image (CSS transform). P toggles; position persisted in the save settings.
- **Selection bar**: appears top-centre under the bar when `selected.size > 0`: "37 pieces · 12 groups · [Gather] [Deselect]". In select mode on touch, a trailing "Done" button.
- **Marquee**: DOM div, 1.5 px dashed accent border + 8 % accent fill.
- **Zone chips**: after Sort by colour, DOM chips positioned at each zone's top-left via camera transform (imperative update on `cameraChanged`, no React re-render): swatch + "Zone 1 · 612". Click → toggles zone filter (dims everything else); click again → All. Chips disappear on the next Tidy/Scatter/Edges-out.
- **Pause**: ⏸ or losing visibility pauses timer; overlay blurs the canvas (`filter: blur(14px)` on the canvas, pointer events blocked) with "Paused · Resume". Timer is not shown running in the background.
- **Help sheet** (?): shortcut table + gesture tips.
- **Settings sheet**: table colour, bevel strength (Subtle/Normal/Strong = 0.6/0.9/1.2), haptics, sound, ghost opacity (0.15/0.25/0.4), minimap on/off.
- **Completion**: image (unblurred, from the GL cross-fade behind), sheet: "Finished · The Starry Night", "Vincent van Gogh · 1889", stats tiles: Time, Moves, Pieces, Groups merged; "New personal best" chip; buttons: Share (Web Share API text: "I completed The Starry Night · 1000 pieces in 1:23:45 on Pieceful" + URL; clipboard fallback + toast), Play again, Try 2000, Home.

### Interactions: desktop vs touch
| Action | Desktop | Touch |
| --- | --- | --- |
| Move piece/group | left-drag | one-finger drag |
| Pan | drag empty table, middle-drag, **Space+drag** anywhere, wheel w/ shift, trackpad 2-finger | one-finger drag on empty, two-finger drag always |
| Zoom | wheel (1.1^-Δ/100), ctrl+wheel (fine), `+ - 0`, double-click empty = fit | pinch, double-tap empty = fit |
| Marquee select | **Shift+left-drag** or **right-drag** anywhere; in Select mode plain drag on empty | Select mode (dock/S): one-finger drag on empty |
| Toggle a piece in selection | Shift+click | tap in Select mode |
| Move selection | drag any selected group | same |
| Deselect | Esc or click empty (not in select mode) | "Done"/tap empty in select mode |
| Snap feedback | glow + sound + flash | + haptic |
| Context | right-click selected → small menu (Gather, Deselect) (optional) | long-press selected → same |

Keyboard (`Keys.ts`): `Space` hold pan, `+`/`=`, `-`, `0` reset zoom to 1:1, `F` fit, `G` ghost, `E` edges only, `P` preview, `S` select mode, `H` hide placed, `M` minimap, `Esc` deselect/exit mode/close panel, `Ctrl/Cmd+A` select all loose, `Ctrl+Shift+E` edges out, `Ctrl+Shift+C` sort by colour, `T` tidy, `?` help. Ignored while a sheet/input has focus.

---

## 6. Image catalog, gallery data, caching, loading

### Data model (`catalog/catalog.ts`)
```ts
export type Category = 'paintings' | 'japanese' | 'space' | 'landscapes'
export interface CatalogImage {
  id: string            // 'wm:starry-night'  (imageId used in routes/saves)
  title: string; artist: string; year: string
  category: Category
  file: string          // Commons file name with underscores, must end in .jpg (lint test)
  hashPath: string      // md5(file)[0] + '/' + md5(file).slice(0,2)  — precomputed at curation, verified by test
  width: number; height: number       // original pixel size
  licence: 'Public domain' | 'CC0' | 'NASA (public domain)' | 'CC BY 4.0'
  credit: string        // 'Google Art Project' | 'NASA, ESA, CSA, STScI' ...
  sourceUrl: string     // https://commons.wikimedia.org/wiki/File:...
  featured?: boolean
  tone: string          // dominant colour hex for placeholder while thumb loads
}
export const CATALOG: CatalogImage[]   // ~24: ≥8 paintings, ≥5 japanese, ≥6 space, ≥5 landscapes
export const byId = (id) => ...
```
`wikimedia.ts`: `thumbUrl(img, w) = https://upload.wikimedia.org/wikipedia/commons/thumb/${hashPath}/${encodeURIComponent(file)}/${w}px-${encodeURIComponent(file)}`; `WIDTHS = [330, 500, 960, 1280, 1920, 3840]`; `pickPlayWidth(pieces, caps) = pieces ≤ 150 ? 1280 : pieces ≤ 500 ? 1920 : 3840`, reduced one step if `navigator.connection?.saveData` or `maxTextureSize < 3840 (→1920)`. Card thumb 500 (960 if dpr ≥ 2), hero 1280 (1920 on ≥ 1400 px wide screens), preview panel 1280. Suggested picks for Opus to verify (title → Commons file): Starry Night, Great Wave off Kanagawa, Girl with a Pearl Earring, Water Lilies (Monet), The Kiss (Klimt), Sunday Afternoon on La Grande Jatte, Café Terrace at Night, Almond Blossom, Hunters in the Snow, Birth of Venus, Impression Sunrise, Wanderer above the Sea of Fog; Hokusai Red Fuji, Hiroshige Sudden Shower over Shin-Ōhashi, Hiroshige Plum Garden, Kuniyoshi/Yoshitoshi print; Pillars of Creation (JWST), Carina Cosmic Cliffs (JWST), Hubble Ultra Deep Field, Earthrise, Blue Marble 2012, Jupiter (Juno); Bierstadt Among the Sierra Nevada, Church Heart of the Andes, Monet Poppies, Hokusai Fuji series. Only JPEG originals; verify `3840px-` returns 200 (dev script `scripts/verify-catalog.mjs`: md5 + HEAD, run manually).

Grid aspect: `chooseGrid(count, width/height)` unchanged algorithm; `makeGrid(cols, rows, imgW, imgH)` where imgW/H are the loaded texture dims.

### Loader (`images/loader.ts`)
```
loadPuzzleImage(imageId, pieces, onProgress): Promise<{ bitmap: ImageBitmap, w, h, thumbUrl }>
  catalog: url = thumbUrl(img, pickPlayWidth(...)); res = await fetch(url, {mode:'cors'})
           stream body with Content-Length → onProgress(loaded,total); blob
  user:    blob from IDB
  bitmap = await createImageBitmap(blob, { premultiplyAlpha:'none', colorSpaceConversion:'default' })
  if max(bitmap.w,h) > maxTextureSize: downscale via createImageBitmap(resizeWidth) 
```
Texture upload: `texImage2D(RGBA8)` from the bitmap, `generateMipmap`, `LINEAR_MIPMAP_LINEAR`/`LINEAR`, `CLAMP_TO_EDGE`; then `bitmap.close()`.

### Caching (vite.config.ts)
```ts
workbox.runtimeCaching: [{
  urlPattern: ({url}) => url.hostname === 'upload.wikimedia.org',
  handler: 'CacheFirst',
  options: { cacheName: 'wm-images', cacheableResponse: { statuses: [0, 200] },
             expiration: { maxEntries: 160, maxAgeSeconds: 180*24*3600, purgeOnQuotaError: true } }
}]
```
Requests are CORS (fetch with `mode:'cors'`, `<img crossorigin="anonymous">`) so responses are non-opaque, cacheable and canvas/WebGL-safe. `navigator.storage.persist()` is requested on the first puzzle start (and after uploads, as today). Offline badge: `caches.open('wm-images').then(c => c.match(url))`. Home prefetches nothing automatically; a "Save for offline" action in the card ⋯ menu fetches 1920 + 3840 (optional, M6).

### User uploads
`MAX_SIDE` 1600 → 3840 (JPEG q0.88, typically 2–5 MB in IDB), thumb 640. Existing 1600 photos keep working (they simply get smaller pieces).

---

## 7. Save format v2 (`types.ts`, `storage/db.ts`)
```ts
export interface SaveV2 {
  v: 2; id: string; imageId: string; seed: number
  cols: number; rows: number; cw: number; ch: number; imgW: number; imgH: number
  n: number
  pieceGroup: ArrayBuffer      // Int32Array(n)
  origin: ArrayBuffer          // Float32Array(2n)  [ox,oy] per group id (valid where id is a head)
  z: ArrayBuffer               // Uint32Array(n)
  flags: ArrayBuffer           // Uint8Array(n)  bit0 locked (LIFTED/SELECTED/TARGET never saved)
  colorClass: ArrayBuffer|null // Uint8Array(n) 0 = none
  rot: null                    // reserved (v3)
  boardGroup: number; zCounter: number
  placed: number; moves: number; elapsedMs: number; completed: boolean
  settings: { ghost: boolean; edgesOnly: boolean; hidePlaced: boolean; zone: number;
              table: string; preview: { open: boolean; x: number; y: number; w: number } | null;
              camera: { scale: number; tx: number; ty: number } | null }
  createdAt: number; updatedAt: number
}
```
- Stored directly in IndexedDB via idb-keyval (structured clone keeps ArrayBuffers; no base64). 5000 pieces ≈ 85 KB.
- `serialize()` copies the SoA arrays (`slice()`), < 1 ms. `restore()` validates lengths and recomputes `members`, `bbox`, `hasEdge`, `loose`, `edgeJoined` (one O(n) pass over neighbours) — nothing derived is stored.
- Autosave: debounce 1000 ms, max wait 5000 ms, flush on hide/pagehide/leave/pause (v1 logic, new constants). During sorting tweens, save after the tween ends.
- `SaveSummary` gains `title, thumb, updatedAt` for the Continue row (summaries are read from the save + catalog, not stored).
- **Migration**: drop v1. `db.ts` on first v2 run (`meta:schema` key < 2): delete every `save:*` with `v !== 2`, delete `done:*` whose id starts with `builtin:`, keep `img:*` and `done:user:*`. Old `/play/builtin:*` routes redirect home with a toast.

---

## 8. Milestones (implementation order) with verification

**M0 — Scaffold (½ day)**: add `earcut`; `types.ts` v2 types/enums; `shapes.ts` `edgeId`/`flattenEdge`; delete scenes; stub catalog with 3 verified images; vite worker config. ✔ `npm run typecheck`, shapes tests (shared edge points identical on both sides; edge ids unique and < edgeCount).

**M1 — Worker + static GL render (2 days)**: `geometry.worker.ts`, `GlRenderer` fill + strip + background passes, image texture, camera, resize/DPR. Render all pieces at solved position with all offsets 0. ✔ 5000-piece cut < 1.5 s desktop (log `stats.ms`); image continuous (no seams at solved position with `edgeJoined` all 1); zoom shows bevel; `about:gpu`/Spector frame shows 2–3 draw calls; idle rAF count 0.

**M2 — Rules + input + save (3 days)**: `Puzzle.ts` SoA, candidate snapping, union-by-size merge, lock-merge, edge joins → `edgeJoined` texture; `Input.ts` drag/pan/pinch/wheel; animations (glide/pop/flash); scatter; `SaveV2` + purge; Game facade; TopBar/Dock minimal. ✔ puzzle tests (merge adopts exact origin, cascade merges, union-by-size relabels smaller, lock merges into boardGroup, candidates pick closest, tolerance cap); drag of a 3000-piece group updates one texel (assert via counter in StateTextures in dev); save round trip test; manual: no hairline between merged pieces at any zoom; 5000 pieces dragging at 60 fps desktop (Performance panel).

**M3 — Catalog, Home, Setup, Loading, caching (2 days)**: curate 24 images (verify 1280/1920/3840), Home hero/continue/tabs/grid/credits, SetupSheet, loader with progress, Workbox runtimeCaching, offline badge, uploads at 3840. ✔ catalog test; DevTools offline after one play → image loads from cache; progress bar shows bytes; grid/px detail line correct for custom counts.

**M4 — Visual polish (2 days)**: bevel tuning + strength setting, lifted shadow, snap target glow, selection tint, table presets + settings, ghost opacity, completion reveal + confetti overlay, CompleteModal share. ✔ screenshot checklist light/dark × 3 tables; reduced-motion path; bevel fades out when < 0.6 px.

**M5 — Selection + sorting (3 days)**: `Selection.ts`, marquee (desktop/touch), selection bar, `color.ts` k-means, layout algorithms, Sort/View menus, zone chips, filters (edges-only, hide placed, zone). ✔ layout tests (no overlaps, nothing on the board, deterministic with seed); colour sort on 5000 pieces < 150 ms; tween of 5000 groups at 60 fps (single 80 KB texSubImage2D per frame); touch select mode on a phone.

**M6 — Pro tools (2 days)**: minimap, preview panel, keyboard map + help sheet, pause overlay, stats (groups, progress), settings sheet, restart. ✔ every shortcut in the help sheet works; minimap tap centres camera; preview position persists in save.

**M7 — Performance + robustness (2 days)**: visible-IBO when < 60 % of pieces are visible (per-piece range copy on camera change, throttled to every frame only while panning), strip skip when zoomed out, adaptive DPR, mobile quality preset, context-loss restore, memory release on leave (check `performance.memory`/Task Manager returns to baseline), `requestIdleCallback` for non-urgent uploads. ✔ acceptance perf numbers below on a mid phone (e.g. Pixel 6a / iPhone 12) and a laptop.

**M8 — Chrome redesign + QA (2 days)**: tokens, glass bars, typography scale, icons, DESIGN.md v2, Lighthouse PWA pass, a11y (focus rings, labels, `aria-pressed`, sheet focus trap). ✔ acceptance checklist.

### Acceptance checklist
- [ ] 5000 pieces: cut + upload ≤ 2.5 s desktop, ≤ 6 s mid phone; UI never frozen > 150 ms (worker + progress).
- [ ] 5000 pieces: pan/zoom/drag 60 fps on a laptop iGPU; ≥ 30 fps on a mid phone (2022-class); dragging a 3000-piece group costs the same as a single piece.
- [ ] Idle: zero rAF callbacks (verify with `requestAnimationFrame` counter in dev overlay).
- [ ] Merged groups show no seams or outlines internally at any zoom/DPR; bevel/outline present on every external edge.
- [ ] Snapping: a piece released within 28 % of a cell (and never < 18 screen px) snaps to the closest valid neighbour or the board; origins of a merged group are bit-identical; cascades (gap-filling) merge all touching neighbours in one drop; glow preview appears while held within tolerance; sound + haptic + flash on snap.
- [ ] Multi-select on desktop (shift/right-drag) and touch (select mode); moving a selection moves whole groups; each dropped group snaps.
- [ ] Sort: Edges out / By colour (zones + chips + filter) / Tidy / Scatter / Gather are animated, non-overlapping and never cover the board.
- [ ] Minimap, preview panel, pause, progress %, stats, shortcuts (help sheet), completion share.
- [ ] Catalog: 24 images with credits, categories, hero, continue row; images cached offline after first play; progress bar during download; resolution ladder (≤150 → 1280, ≤500 → 1920, else 3840).
- [ ] Save v2 round-trips at 5000 pieces (≤ 100 KB), autosave throttled, v1 data purged without errors, user photos preserved.
- [ ] WebGL2 missing → blocker screen; context loss → restored without losing progress; leaving Play frees GPU/CPU memory.
- [ ] Light/dark × 6 table presets look intentional; typography and glass chrome match the token spec; a11y basics pass.

### Critical Files for Implementation
- C:\Projects\puzzle\web\src\engine\gl\GlRenderer.ts (NEW — passes, state textures, effects IBOs, context loss)
- C:\Projects\puzzle\web\src\workers\geometry.worker.ts (NEW — flatten/earcut/strips/colour, transferables)
- C:\Projects\puzzle\web\src\engine\Puzzle.ts (REWRITE — SoA groups, union-by-size merge, magnetic snapping, edge joins)
- C:\Projects\puzzle\web\src\engine\Game.ts (REWRITE — loader pipeline, selection/sort commands, tweens, SaveV2)
- C:\Projects\puzzle\web\src\engine\layout.ts (CHANGED — packShelves/bands, edges-out, colour zones, tidy, gather)
- C:\Projects\puzzle\web\src\catalog\catalog.ts + C:\Projects\puzzle\web\vite.config.ts (NEW/CHANGED — Wikimedia catalog, runtime caching)
