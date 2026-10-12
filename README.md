# Pieceful

**Professional jigsaw puzzles of the world's most famous artworks. 100 to 5000 pieces, installable, works offline.**

- **31 masterpieces** (public domain / CC0, from Wikimedia Commons), self-hosted as optimized WebP:
  - Van Gogh, Monet, Vermeer, Klimt and Botticelli
  - Bruegel's *Tower of Babel* and Bosch's *Garden of Earthly Delights*, which are ideal for 3000–5000 pieces
  - Hokusai and Hiroshige prints
  - James Webb and Apollo photos
- **Your own photos**, up to 3840 px, stored only on your device.
- **100 / 300 / 500 / 1000 / 2000 / 3000 / 5000 pieces**, or any custom count.
- **WebGL2 engine:**
  - Triangulated pieces with a lighting-based bevel, soft lift shadows and snap glows.
  - Merged pieces are perfectly seamless.
  - 5000 pieces are cut in about 0.2 s in a Web Worker and render at 60 fps.
- **Magnetic snapping:** drop a piece near its neighbour and it lands exactly in place. While you hold it, the match glows, and a piece dropped into a gap joins every neighbour at once.
- **Sorting tools:**
  - **Edges out**, **By colour** (k-means colour zones you can filter), **Tidy grid**, **Scatter** and **Gather**.
  - **Box selection** (Select tool, Shift-drag or right-drag) to move many pieces together.
- **Pro view tools:** draggable preview ("box lid"), ghost image, edge pieces only, hide placed pieces, minimap, pause.
- **Guide:**
  - A first-run welcome tour.
  - A full in-app guide (Basics, Moving, Sorting, Shortcuts), opened with `?`.
- **Keyboard shortcuts:**
  - Space-drag pan, `+ - 0 F` zoom, `G P E H M S T`
  - `Ctrl+Shift+E` / `Ctrl+Shift+C` to sort, `Ctrl+A` to select, `Esc` to deselect
- **Saving:** autosave and resume (a compact binary save, about 85 KB for 5000 pieces), plus best times.
- **PWA:** installable; the gallery works offline, and each artwork is cached after it's first played; update prompt.
- **Server:** a single Go binary with the whole site embedded (gzip, ETags, immutable assets, 30-day artwork caching).

## Stack

| Part | Tech |
| --- | --- |
| UI | React 19 + TypeScript + Vite, zustand |
| Engine | TypeScript + **WebGL2** (`web/src/engine`), geometry in a Web Worker (earcut) |
| PWA | vite-plugin-pwa (Workbox precache + runtime artwork cache) |
| Storage | IndexedDB via idb-keyval |
| Server | Go 1.26, `go:embed`, standard library only |

## Run it

```bash
npm install
```

**Dev** (hot reload): http://localhost:5173

```bash
npm run dev
```

**Production** builds the web app into `server/dist` and compiles `bin/pieceful.exe` with everything embedded:

```bash
npm run build
```

```bash
npm start
```

That serves on http://localhost:8080. Use `-addr :9000` or set `PORT` to change it.

Other scripts:
- `npm test`: engine unit tests, including a 5000-piece geometry test.
- `npm run typecheck`
- `npm run icons -w web`
- `npm run fetch-art -w web`: re-downloads and re-encodes the artwork catalog from Wikimedia Commons, politely and with retries. The raw files are cached in `web/.art-src`.
- `npm run build:server:linux`

## Deployment (GitHub Actions → Docker on the server)

Every push to `main` runs `.github/workflows/deploy.yml`:

1. **Test**: typecheck, unit tests, `go vet`.
2. **Image**: a multi-stage `Dockerfile` builds the web app, then the Go binary with everything embedded, into a tiny distroless image (non-root, with a health check). It's pushed to `ghcr.io/hadirajabi80/pieceful` (`:latest` and `:sha-xxxxxxx`).
3. **Deploy**: the workflow SSHes into the server, then:
   - pulls the image,
   - replaces the `pieceful` container (`--restart unless-stopped`, host port **6060** → 8080),
   - waits until Docker reports it healthy,
   - prunes old Pieceful images.

### One-time setup

Run these **on the server** (Linux with Docker).

Create a deploy key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/pieceful_deploy -N "" -C pieceful-deploy
```

Authorize it for SSH logins:

```bash
cat ~/.ssh/pieceful_deploy.pub >> ~/.ssh/authorized_keys
```

Print the private key to paste into GitHub (never commit it):

```bash
cat ~/.ssh/pieceful_deploy
```

The SSH user must be able to run `docker` (root, or a member of the `docker` group). If a firewall is on, open the port:

```bash
sudo ufw allow 6060/tcp
```

Then, in **GitHub**, go to the repo's Settings → Secrets and variables → Actions and add:

| Name | Kind | Value |
| --- | --- | --- |
| `SSH_PRIVATE_KEY` | secret | the private key printed above |
| `SSH_USER` | secret | the SSH user, e.g. `root` |
| `SSH_PORT` | secret (optional) | defaults to `22` |
| `DEPLOY_HOST` | variable (optional) | defaults to `167.233.87.63` |

Re-run the workflow (Actions → CI / Deploy → Run workflow). The site is then live at **http://167.233.87.63:6060**.

> **HTTPS:** browsers only enable the PWA features on HTTPS: installing the app, the offline service worker, and share/clipboard. The puzzle itself works fine over plain HTTP. For the full PWA, point a domain at the server and put a TLS reverse proxy (Caddy, Traefik or nginx with Let's Encrypt) in front of port 6060.

Run the same image anywhere:

```bash
docker run -d --name pieceful --restart unless-stopped -p 6060:8080 ghcr.io/hadirajabi80/pieceful:latest
```

## Layout

```
web/src/engine/      Puzzle (rules, SoA + union-by-size merging, magnetic snapping), geometry (worker pipeline),
                     gl/ (WebGL2 renderer + shaders), layout (sorting algorithms), color (k-means), Input, Game
web/src/workers/     geometry worker
web/src/catalog/     artwork catalog (+ generated art-meta.json)
web/src/screens/     Home, SetupSheet, Credits, Play (+ play/: top bar, dock, menus, minimap, preview, tour…)
web/src/components/  Sheet, Toast, Icon, GuideSheet…
web/public/art/      artwork in WebP (thumb ≤640, mid ≤2048, full ≤4096)
server/              Go static server
docs/DESIGN.md       v2 product + architecture design (DESIGN-v1.md is the original)
```

## Credits

Artwork comes from Wikimedia Commons: public-domain paintings and prints, and NASA/ESA/CSA imagery. The in-app Credits sheet lists every image with its source page.
