# Antigravity Live Share

Real-time collaborative development for the [Antigravity IDE](https://antigravity.google) — sessions, live presence, conflict-free text sync, voice chat, and video, wrapped in a glassmorphism UI.

> **Status:** active development · `v0.1.0` · MIT licensed
>
> 🟣 Sessions &nbsp;·&nbsp; 🟣 Presence &nbsp;·&nbsp; 🟣 Glass UI &nbsp;·&nbsp; 🟣 Text Sync (beta) &nbsp;·&nbsp; 🟣 Voice Chat &nbsp;·&nbsp; ⚪ Live Video *(in progress)* &nbsp;·&nbsp; ⚪ Join Approval

## 📖 Documentation

Full docs live in this repo and are built with [Blume](https://useblume.dev):

```bash
npm install     # at repo root
npm run dev     # docs site with search, i18n, interactive demos
```

Highlights: [Quickstart](docs/getting-started/quickstart.mdx) · [Architecture](docs/getting-started/architecture.mdx) · [Protocol reference](docs/reference/protocol.mdx) · [Roadmap board](docs/roadmap/status.mdx)

## How it works

```
                 Antigravity IDE
                       │
                       ▼
              ┌─────────────────┐
              │  Live Share     │
              │     Extension   │  session · presence · CRDT sync · voice/video mesh
              └────────┬────────┘
                       │  WebSocket (+ WebRTC peer-to-peer media)
                       ▼
              ┌─────────────────┐
              │ Collaboration   │  rooms, JSON relay — no storage, no media
              │     Server      │
              └────────┬────────┘
                       ▼
               Host ◀──────▶ Guests
```

1. **Start Live Share** — the host creates a room via `POST /rooms`.
2. **Share the ID** — guests join through *Live Share: Join Session*.
3. **Everything syncs** — cursors, selections, keystrokes (Yjs CRDT), and optional voice/video flow between peers.
4. **The server stays dumb** — it validates JSON and fans frames out. Documents are never stored; empty rooms vanish.

## Features

| Feature | What you get |
| --- | --- |
| **Sessions** | Server-assigned room IDs, auto-reconnect (3s), policy-aware teardown |
| **Presence** | Peer cursors/selections as colored decorations, hashed per client ID, 150ms throttle |
| **Text sync** | One Yjs doc per file; binary deltas over state vectors — concurrent edits merge cleanly |
| **Voice chat** | Full WebRTC mesh, opus over data channels, ffmpeg capture / ffplay playback (capability-detected) |
| **Live video** | Webcam frames over the same mesh, rendered in a glass webview panel |
| **Glass UI** | Status bar entry point + glassmorphism panel: role badge, copy ID, live peer list |
| **Docs site** | Purple + light-grey Blume site with search, EN/ES i18n, versioning-ready, interactive islands |

### Requirements

- Node.js ≥ 18 for the server; Antigravity IDE or VS Code `^1.90` for the extension
- **FFmpeg on PATH** for voice/video capture & playback (optional — everything else works without it)

## Repository layout

```text
extension/          VS Code / Antigravity extension (TypeScript)
  src/connection.ts     WebSocket client + room creation + reconnect
  src/session.ts        Session state (id, role)
  src/presence.ts       Peer cursor decorations
  src/sync.ts           Yjs CRDT document sync
  src/voice.ts          WebRTC audio mesh
  src/video.ts          WebRTC video mesh (MJPEG-over-DC)
  src/panel.ts          Glassmorphism session webview
  src/statusBar.ts      Native status bar indicator
server/             Node.js signaling relay (ws)
plugins/live-share/ Antigravity plugin manifest
docs/               Blume documentation content (EN + ES)
islands/            Interactive docs components
```

## Quickstart

```bash
# 1 — server
cd server && npm install && npm run compile && npm start
# Live Share server listening on http://localhost:3000

# 2 — extension
cd extension && npm install && npm run compile
# open extension/ in Antigravity/VS Code and press F5
```

Then: **Command palette → Live Share: Start Session** (host) and
**Live Share: Join Session** (guest). Configure `liveShare.serverUrl` for
non-local servers.

## Protocol in one glance

All traffic is UTF-8 JSON over one WebSocket; the server wraps client payloads
as `{ "type": "message", "from": "<clientId>", "data": "<json>" }`.

| Payload | Purpose |
| --- | --- |
| `presence.hello` / `presence.cursor` | Names and cursor positions |
| `doc.state` / `doc.update` | Yjs snapshots and binary deltas (base64) |
| `voice.offer` / `voice.answer` / `voice.ice` | WebRTC audio mesh signaling |
| `video.offer` / `video.answer` / `video.ice` | WebRTC video mesh signaling |

See the full [protocol reference](docs/reference/protocol.mdx).

## Development workflow

This project uses a strict per-feature ritual:

1. **One feature per branch** — `feature/<name>` or `docs/<name>`
2. The branch's first commit is exactly `first commit in this branch`
3. On completion: stage **one file → conventional commit → push**, repeated
   until `git status` is clean
4. Verify (compile + smoke tests against the live server) before committing

```bash
git log --oneline   # the history reads like a changelog — because it is one
```

## Roadmap

```text
✅ client–server connection   ✅ presence            ✅ glass UI panel
✅ text sync (CRDT)           ✅ voice chat          ✅ docs site
▶️ live video                 ⬜ join approval       ⬜ read-only guests
```

## License

[MIT](LICENSE)
