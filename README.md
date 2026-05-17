# EuroScope Ground Radar Map Editor

A browser-based editor for **EuroScope GRpluginMaps v1.6** map files (`GRpluginMaps.txt`). Load, visualise, and edit ground radar map data on a live Leaflet map, then save changes directly back to a GitHub repository as a pull request.

> **Live demo:** [https://dev.jkstr.eu](https://dev.jkstr.eu)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript, Vite 5 |
| Map | Leaflet 1.9 + React-Leaflet 4 |
| State | Zustand 4 + Immer |
| Styling | Tailwind CSS 3 |
| PDF rendering | pdfjs-dist 4 (in-browser, Web Worker) |
| Backend | Node.js + Express (CommonJS) |
| Container | Docker — multi-stage, non-root, dumb-init |
| CI/CD | GitHub Actions → GitHub Container Registry |

---

## Features

### File handling
- **Drag-and-drop** a `GRpluginMaps.txt` file onto the window, or load it from disk via the toolbar
- **Load from GitHub** — authenticate via OAuth, browse any repo and branch, and pull the file directly into the editor
- **Export** the edited file back to disk (browser download)

### Map visualisation
- All map sections rendered with their correct colours on an interactive Leaflet map (OSM, Satellite, or Dark basemap)
- Toggle individual map sections on/off via the sidebar layer list
- Auto-fits the viewport to the loaded data on first open

### Drawing tools
- **Select** — click any element to select it; drag vertex handles or midpoint handles to reshape it
- **Line** — click two points to draw a line segment; optional name prompt after placement
- **Polygon** — click vertices; close by pressing **Enter**, clicking near the first point (green snap ring appears), or double-clicking
- **Text** — click to place a text label; inline edit via floating input
- **Delete** — click any element to remove it
- **Undo / Redo** — full history stack (Ctrl+Z / Ctrl+Y)
- Escape cancels any in-progress draw operation

### Vertex snapping
Clicks snap to the nearest existing vertex within a configurable pixel radius, making it easy to connect shapes precisely.

### PDF overlay
- Load any PDF onto the map as a georeferenced overlay
- Drag to reposition, scale from center via corner handle, rotate freely
- Adjustable opacity
- Lock/unlock to prevent accidental movement while the overlay stays geo-anchored through pan and zoom
- Multi-page PDFs show a visual thumbnail picker; thumbnails render progressively in the background
- Smooth zoom animation — overlay moves in sync with Leaflet's tile transition

### GitHub integration
- OAuth login via a server-side proxy (no client secret exposed to the browser)
- Browse repos and branches with a file picker
- Save edits as a **pull request** with a configurable branch name, commit message, PR title, and description

### Keyboard shortcuts
- `Ctrl+Z` / `Ctrl+Y` — undo / redo
- `Delete` / `Backspace` — delete selected element
- `Escape` — cancel draw or deselect
- `Enter` — commit polygon while drawing

---

## Running locally

```bash
cp .env.example .env          # fill in GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET
npm install
npm run dev                   # starts Express on :3001 and Vite on :5173
```

## Running with Docker

```bash
docker build -t euroscope-map-editor .
docker run -p 3001:3001 --env-file .env euroscope-map-editor
```

Then open `http://localhost:3001`.

## Self-hosting via GitHub Container Registry

After pushing to `main`, GitHub Actions builds and publishes the image automatically:

```bash
docker pull ghcr.io/YOUR_USERNAME/euroscope-ground-radar-editor:latest

docker run -d \
  --name euroscope \
  -p 3001:3001 \
  --restart unless-stopped \
  -e GITHUB_CLIENT_ID=xxx \
  -e GITHUB_CLIENT_SECRET=xxx \
  -e FRONTEND_URL=https://your-domain.example.com \
  ghcr.io/YOUR_USERNAME/euroscope-ground-radar-editor:latest
```

---

## Environment variables

| Variable | Description |
|---|---|
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `FRONTEND_URL` | Public URL of the app (used for CORS in production) |
| `PORT` | Server port (default: `3001`) |
| `NODE_ENV` | Set to `production` in Docker |
