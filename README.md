# Zarmed Pratiksha Hospital — Cashier

Hospital cashier workstation with Excel sheets, account codes, and workers from the external REST API.

## Quick start (local)

```bash
cd cashier-app
npm install
npm run db:seed
npm run dev
```

Open `http://localhost:5173`. **Login:** `cashier` / `1234`

## Docker

See [DOCKER.md](DOCKER.md).

```bash
docker compose up -d --build
```

Then open `http://localhost:8080`.

## Environment

Configure in `.env` (see `.env.example`):

```env
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_password
PGDATABASE=cashier
VITE_BMS_API_URL=http://127.0.0.1:4002
VITE_USE_MOCK=false
EXTERNAL_API_URL=http://192.168.1.250:8000
EXTERNAL_API_KEY=********
```
