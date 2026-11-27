# Hikvision Remote CCTV Web Platform

Self-hosted web dashboard for streaming live Hikvision NVR/IP camera feeds, capturing ISAPI snapshots, controlling PTZ cameras, and receiving real-time motion/intrusion alerts over your own domain (`https://cctv.yourdomain.com`) with zero open router ports.

## Architecture

- **`go2rtc`** (internal Docker network only, port `1984`): pulls LAN RTSP streams (H.264) and relays MSE/WebRTC over WebSockets.
- **Express Backend** (`backend/`, port `3001`): handles JWT `HttpOnly` cookie authentication, ISAPI HTTP Digest calls (snapshots, PTZ, alertStream SSE), and authenticated HTTP/WS proxying for `/stream/*`.
- **React + Vite Frontend** (`frontend/`): dark-mode responsive dashboard served by Express in production.
- **Cloudflare Tunnel** (`cloudflared`): securely exposes `http://app:3001` to your custom domain behind ISP CGNAT with zero port forwarding.

---

## 1. Hikvision NVR / Camera Preparation (LAN)

1. Assign your NVR/cameras a **static LAN IP** (or DHCP reservation, e.g. `192.168.1.100`).
2. Create a dedicated **Operator / Viewer account** on the NVR (avoid using root `admin`) with permissions limited to Live View, PTZ (if applicable), and Snapshot/Playback.
3. Under **Network → Advanced Settings → Integration Protocol**, ensure **ISAPI** is enabled and **HTTP Authentication** is set to **Digest** (not Basic).
4. Set **Video Encoding** to **H.264** on both Main Stream (`101`, `201`, ...) and Sub Stream (`102`, `202`, ...) so browser MSE/WebRTC playback works reliably.
5. Never enable DMZ or port-forward `554` or `80` on your router.

---

## 2. Configuration Setup

1. Copy the templates (never commit `.env` or `go2rtc.yaml`):
   ```bash
   cp .env.example .env
   cp go2rtc.example.yaml go2rtc.yaml
   ```
   *(If `go2rtc.yaml` was previously tracked as an empty placeholder in Git, untrack it once with `git rm --cached go2rtc.yaml`.)*

2. Generate a bcrypt password hash and a 64-character `JWT_SECRET`:
   ```bash
   npm --prefix backend run hash-password
   ```

3. Fill in `.env`:
   - `PUBLIC_ORIGIN=https://cctv.yourdomain.com`
   - `APP_ADMIN_USER`, `APP_ADMIN_PASS_HASH`, `JWT_SECRET`
   - `NVR_IP`, `NVR_PORT`, `NVR_USER`, `NVR_PASS`
   - `CAMERAS_JSON` matching the stream keys in `go2rtc.yaml`
   - `CLOUDFLARE_TUNNEL_TOKEN` (for production)

4. Edit `go2rtc.yaml` with your camera RTSP URLs (`101` HD / `102` SD). In production, you may also uncomment `api.origin` with your custom domain.

---

## 3. Cloudflare Zero Trust Tunnel Setup

1. In the **Cloudflare Zero Trust Dashboard**, open **Networks → Tunnels → Create a tunnel** (`Cloudflared`).
2. Copy the tunnel token into `CLOUDFLARE_TUNNEL_TOKEN` in `.env`.
3. Add a **Public Hostname** route:
   - **Subdomain / Domain:** `cctv.yourdomain.com`
   - **Service Type:** `HTTP`
   - **URL:** `app:3001`

*(For direct VPS/public-IP deployments without Cloudflare Tunnel, see `deploy/Caddyfile.example`.)*

---

## 4. Running Locally (Development)

1. Start the local `go2rtc` container (bound to `127.0.0.1:1984`):
   ```bash
   docker compose up -d
   ```
2. Set `GO2RTC_INTERNAL_URL=http://127.0.0.1:1984` in `.env` (or `backend/.env`), then run the backend and frontend dev servers:
   ```bash
   npm --prefix backend install
   npm --prefix backend run dev
   ```
   In a second terminal:
   ```bash
   npm --prefix frontend install
   npm --prefix frontend run dev
   ```
3. Open `http://localhost:5173` (Vite proxies `/api` and `/stream` to `:3001`).

### Running Automated Tests
```bash
npm --prefix backend test
```

---

## 5. Production Deployment

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Verify containers are running:
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app
```
