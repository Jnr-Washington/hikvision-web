# AGENTS.md — Hikvision Remote CCTV Web Platform

## 1. Project Goal
Build a secure, self-hosted web application that streams live video from a local Hikvision NVR/IP camera setup to a custom frontend UI hosted behind a custom public domain (`https://cctv.yourdomain.com`).

The system must translate Hikvision's local RTSP feeds into browser-playable video (MSE/WebRTC via `go2rtc`), proxy Hikvision ISAPI controls (snapshots, PTZ, live motion alerts) through an authenticated backend, and support remote access behind ISP CGNAT with zero open router ports via Cloudflare Tunnel (with an optional direct reverse-proxy setup for public IP/VPS deployments).

---

## 2. Architecture Overview
All public traffic enters through a single authenticated entrypoint so neither the Hikvision NVR nor `go2rtc` is ever directly exposed:

```text
[Hikvision NVR / Cameras (LAN only)]
   ├── RTSP (H.264, port 554) ──────────► [go2rtc container (internal network)]
   └── ISAPI (HTTP Digest, port 80) ────► [Node.js / Express Backend]
                                              ├── Auth (JWT HttpOnly Cookie)
                                              ├── REST API (/api/cameras, /api/snapshot, /api/ptz)
                                              ├── SSE Alert Bridge (/api/events/stream)
                                              ├── Authenticated WS/HTTP Proxy (/stream/* -> go2rtc:1984)
                                              └── Static Frontend UI (/)
                                                       ▲
                                                       │ (Single internal port: 3001)
                                          [Cloudflare Tunnel / Caddy]
                                                       ▲
                                                       │ (HTTPS / WSS, port 443)
                                          [User Browser on Custom Domain]
```

---

## 3. Non-Negotiable Security & Engineering Rules
1. **Zero Hardcoded Secrets:** Never hardcode NVR IPs, camera usernames/passwords, RTSP URLs, JWT secrets, or tunnel tokens in source files or frontend code. Always read from environment variables and provide `.env.example` and `go2rtc.example.yaml` templates.
2. **Git Hygiene First:** Create `.gitignore` before scaffolding config files. It must exclude `.env`, `backend/.env`, `go2rtc.yaml`, `node_modules/`, and any tunnel credentials.
3. **Single Authenticated Surface:** Never expose `go2rtc` port `1984` publicly in production. Proxy `/stream/*` (both HTTP player assets like `video-stream.js` and WebSocket upgrades `/stream/api/ws`) through the Express backend and verify the user's auth cookie on both HTTP requests and WebSocket `upgrade` events.
4. **Strict Input Sanitization:**
   - Validate all `:channel` and `:presetId` route params against strict numeric regex (`/^\d{1,4}$/`) to prevent path traversal or SSRF.
   - Clamp PTZ `pan`, `tilt`, and `zoom` values to integers between `-100` and `100` before interpolating into Hikvision XML payloads.
5. **No Direct Camera Exposure:** Never instruct the user to enable DMZ or forward port `554` or `80` on their router.
6. **Codec & Compatibility:** Assume H.264 streams and prioritize `mse,webrtc` playback order so streams work reliably over HTTPS/WSS tunnels (Cloudflare Tunnel) as well as local LAN.
7. **Mock-First Testing:** Do not attempt to connect to live LAN IPs while `.env` contains placeholder values. Write unit/integration tests against mocked Hikvision ISAPI responses so backend auth, routing, and XML formatting are verified before the user supplies real NVR credentials.

---

## 4. Target Workspace Layout
Create and maintain this folder structure:

```text
hikvision-web/
├── AGENTS.md
├── .gitignore
├── .env.example
├── docker-compose.yml          # Local development stack
├── docker-compose.prod.yml     # Production stack (internal go2rtc + app + cloudflared)
├── go2rtc.example.yaml         # Template for RTSP stream definitions
├── api-test.http               # VS Code REST Client test requests
├── README.md                   # Human setup & deployment checklist
├── deploy/
│   └── Caddyfile.example       # Optional direct reverse proxy (static IP / VPS)
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── server.js           # Express app + HTTP/WS server bootstrap
│   │   ├── config.js           # Env validation + camera registry loader
│   │   ├── middleware/
│   │   │   └── auth.js         # JWT cookie auth + WebSocket upgrade verification
│   │   ├── services/
│   │   │   ├── hikvision.js    # HTTP Digest ISAPI client (snapshots, PTZ, alertStream)
│   │   │   └── streamProxy.js  # Authenticated HTTP + WS proxy to go2rtc
│   │   └── routes/
│   │       ├── auth.routes.js
│   │       ├── cameras.routes.js
│   │       └── events.routes.js
│   └── tests/
│       └── api.test.js         # Automated tests (auth, input sanitization, mocked ISAPI)
└── frontend/
    ├── index.html
    ├── styles.css
    └── app.js                  # Login view, multi-cam grid, HD/SD switch, PTZ, snapshots, alerts
```

---

## 5. Configuration Contract (`.env.example`)
Generate `.env.example` with these exact keys and clear comments:

```env
# Server
NODE_ENV=development
PORT=3001
PUBLIC_ORIGIN=http://localhost:3001

# App Login Credentials (protecting the web UI and streams)
APP_ADMIN_USER=admin
APP_ADMIN_PASS_HASH=           # bcrypt hash; provide a helper npm script `npm run hash-password`
JWT_SECRET=                    # 64-char random hex string

# Hikvision NVR / Camera (LAN-only, view/operator account — avoid root admin)
NVR_IP=192.168.1.100
NVR_PORT=80
NVR_USER=viewer
NVR_PASS=REPLACE_ME

# Camera Registry (JSON array mapping friendly IDs to go2rtc stream keys & ISAPI channels)
CAMERAS_JSON=[{"id":"front_door","name":"Front Door","hdStream":"front_door_hd","sdStream":"front_door_sd","snapshotChannel":"101","ptzChannel":"1","hasPtz":true}]

# Internal Media Relay
GO2RTC_INTERNAL_URL=http://go2rtc:1984

# Production Remote Tunnel (Cloudflare Zero Trust)
CLOUDFLARE_TUNNEL_TOKEN=
```

---

## 6. Phased Implementation Plan
Work strictly **one phase at a time**. Present a brief plan before writing code, complete the phase, run its verification commands, and summarize results before moving on.

### Phase 1 — Workspace, Templates & Local `go2rtc` Relay
- Create `.gitignore`, `.env.example`, `go2rtc.example.yaml`, and `docker-compose.yml`.
- In `go2rtc.example.yaml`, configure sample H.264 main (`101`) and sub (`102`) RTSP streams and restrict `api.origin` via comments for prod.
- **Verify:** Run `docker compose config` to confirm valid Compose syntax. Confirm `.gitignore` properly ignores `.env` and `go2rtc.yaml`.

### Phase 2 — Authenticated Express Backend & ISAPI Proxy
- Initialize `backend/package.json` with `"type": "module"`.
- Use: `express`, `cookie-parser`, `helmet`, `express-rate-limit`, `dotenv`, `bcryptjs`, `jsonwebtoken`, `digest-fetch`, `node-fetch`, `http-proxy-middleware`. Add `nodemon` for dev and Node's built-in test runner (`node --test`) for tests.
- Implement:
  - `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` using `HttpOnly`, `SameSite=Lax` (and `Secure` in production) JWT cookies, plus rate limiting on login.
  - `npm run hash-password` CLI helper script so the user can easily generate `APP_ADMIN_PASS_HASH`.
  - `GET /api/cameras` returning sanitized camera metadata from `CAMERAS_JSON`.
  - `GET /api/snapshot/:channel` proxying Hikvision `GET /ISAPI/Streaming/channels/{channel}/picture` as `image/jpeg`.
  - `POST /api/ptz/:channel` accepting `{ pan, tilt, zoom }` and forwarding XML to `PUT /ISAPI/PTZCtrl/channels/{channel}/continuous`; plus `POST /api/ptz/:channel/preset/:presetId` forwarding to `/ISAPI/PTZCtrl/channels/{channel}/presets/{presetId}/goto`.
  - `GET /api/events/stream` (SSE) parsing multipart XML events from `GET /ISAPI/Event/notification/alertStream` with automatic reconnect/backoff and clean teardown when the browser disconnects.
  - Authenticated proxy at `/stream/*` forwarding HTTP and WebSocket (`upgrade`) traffic to `GO2RTC_INTERNAL_URL`, rejecting unauthenticated upgrades with HTTP `401`.
- **Verify:** Write and pass `backend/tests/api.test.js` covering:
  1. Unauthenticated requests to `/api/cameras`, `/api/snapshot/101`, and `/stream/api/ws` return `401`.
  2. Valid login sets the cookie and unlocks protected endpoints.
  3. Invalid channel IDs (e.g., `../etc`) return `400`.
  4. Out-of-range PTZ values are clamped to `[-100, 100]` and generate valid XML.
  5. Mocked ISAPI snapshot returns `200` with `image/jpeg`.

### Phase 3 — Custom Frontend Dashboard (`frontend/`)
- Build a clean, responsive dark-mode UI served by Express:
  - **Login Overlay:** Shown automatically if `/api/auth/me` returns `401`.
  - **Camera Grid:** Dynamically renders cards from `/api/cameras` using `<video-stream>` loaded from `/stream/video-stream.js` (same-origin, authenticated).
  - **Per-Camera Controls:**
    - HD / SD stream switcher (`mode="mse,webrtc"`, connecting to `wss://.../stream/api/ws?src=<streamName>` or `ws://` on localhost).
    - Snapshot button (downloads JPEG from `/api/snapshot/:channel`).
    - Fullscreen toggle and audio mute/unmute toggle.
    - Conditional PTZ D-pad (only rendered when `hasPtz: true`) using `pointerdown` to start movement and `pointerup`/`pointerleave`/`pointercancel` to send stop `{ pan: 0, tilt: 0, zoom: 0 }`.
  - **Live Alert Drawer:** Subscribes to `/api/events/stream` via `EventSource` and displays timestamped motion/intrusion alerts with a connection status badge.
- **Verify:** Start the server locally, launch the headless browser tool to load `http://localhost:3001`, verify the login screen renders without console errors, log in with a test account, confirm camera cards and controls render cleanly at desktop and mobile viewports, and confirm zero uncaught JS errors.

### Phase 4 — Remote Domain Deployment & Documentation
- Create `backend/Dockerfile` (multi-stage or lean `node:22-alpine` non-root user).
- Create `docker-compose.prod.yml` orchestrating:
  - `go2rtc` on an internal bridge network (`expose: ["1984"]`, no public host ports).
  - `app` (Express backend + frontend) connected to the internal network.
  - `cloudflared` (`cloudflare/cloudflared:latest`, command: `tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}`) routing `https://cctv.yourdomain.com` -> `http://app:3001`.
- Create `deploy/Caddyfile.example` for direct HTTPS reverse proxy users who have a public IP/VPS.
- Create `api-test.http` and a concise `README.md` documenting:
  1. Required Hikvision NVR settings (static LAN IP, view-only user, Digest auth, H.264 encoding).
  2. Creating `.env` and `go2rtc.yaml` from templates and generating a password hash.
  3. Connecting the custom domain in Cloudflare Zero Trust Dashboard to `http://app:3001`.
  4. Local dev vs. production launch commands.
- **Verify:** Validate `docker compose -f docker-compose.prod.yml config` and confirm the Docker image builds cleanly (`docker build ./backend`).

---

## 7. Agent Execution Preferences
- Ask before switching the frontend from Vanilla ES modules to a framework (such as React + Vite).
- Never modify real `.env` or `go2rtc.yaml` files if they already exist with user credentials.
- After completing all 4 phases, present a final readiness checklist of the exact manual values the user needs to fill in before running `docker compose -f docker-compose.prod.yml up -d`.