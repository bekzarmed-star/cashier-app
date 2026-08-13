# Docker + nginx

Full stack: **PostgreSQL + API + nginx web**.

For a short boss/share checklist, see **[SHARE.md](./SHARE.md)**.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running

## Start

From `cashier-app`:

```bash
docker compose up -d --build
```

Or:

```bash
npm run docker:up
```

| Service | URL |
|---------|-----|
| Web UI (nginx) | http://localhost:8080 |
| API | http://localhost:4002 |
| Postgres | localhost:5433 (user/pass from `.env`) |

**Login:** `cashier` / `1234`  
**Admin:** http://localhost:8080/admin/login

## Share on LAN

```text
http://<this-PC-LAN-IP>:8080
```

Firewall: allow inbound TCP **8080**. Details in [SHARE.md](./SHARE.md).

## Stop

```bash
docker compose down
```

## Notes

- nginx config: `deploy/nginx.conf` — SPA routes + `/api` proxy to `api:4002`
- Web image builds the React app, then serves it with nginx
- DB data persists in volume `cashier_pgdata`
- External employees API: `EXTERNAL_API_URL` / `EXTERNAL_API_KEY` in `.env`
- ERP sync: `ERP_*` vars in `.env`
- On first start the API waits for Postgres, seeds data, then listens
- Admin E-imzo key is mounted from `server/keys/`
