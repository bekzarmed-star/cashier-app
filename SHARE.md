# Cashier app — run & share (Docker + nginx)

One command starts **PostgreSQL + API + nginx web**.  
Boss / colleagues open one URL in the browser — no Node install needed on their PC.

## Start (on your PC)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and wait until it says **Running**.
2. Open a terminal in the `cashier-app` folder.
3. Run:

```bash
docker compose up -d --build
```

4. Open on this PC: **http://localhost:8080**

| What | Address |
|------|---------|
| Web (nginx) | http://localhost:8080 |
| API (optional direct) | http://localhost:4002 |
| Postgres | localhost:5433 |

## Share with your boss (same Wi‑Fi / office network)

1. Find this PC’s LAN IP, for example:
   - Windows: `ipconfig` → look for **IPv4** (often `192.168.x.x`)
2. Send this link:

```text
http://YOUR_LAN_IP:8080
```

Example: `http://192.168.1.45:8080`

3. If it does not open on his phone/PC:
   - Allow **port 8080** in Windows Firewall (inbound TCP)
   - Both devices must be on the same network
   - Docker Desktop must stay open while you share

nginx already serves the UI and proxies `/api` — one port is enough for sharing.

## Logins

| Role | Username | Password | Notes |
|------|----------|----------|--------|
| Cashier | `cashier` | `1234` | Main workstation |
| Supervisor | `supervisor` | `1234` | |
| Admin | `admin` | `Zarmed@Admin#2026!Kp` | Also needs key file `server/keys/admin.eimzo.key` at `/admin/login` |

Admin page: `http://YOUR_LAN_IP:8080/admin/login`

## Useful pages

- Cashier Excel: `/excel` → button **Sync ERP**
- Workers: `/workers`
- Settings: `/settings`

## Stop

```bash
docker compose down
```

Data stays in Docker volume `cashier_pgdata` (DB is kept).

## Rebuild after code changes

```bash
docker compose up -d --build
```

Then hard-refresh the browser (`Ctrl+F5`).

## What’s inside

```
Browser  →  nginx (:8080)  →  static React UI
                         ↘  /api/*  →  Node API (:4002)  →  PostgreSQL
```

Config lives in `deploy/nginx.conf`. Compose file: `docker-compose.yml`.
