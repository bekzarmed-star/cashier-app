#!/bin/sh
set -e

echo "Waiting for PostgreSQL at ${PGHOST}:${PGPORT}..."
node server/src/waitDb.js

echo "Seeding database..."
node server/src/seed.js

echo "Starting Cashier API on :${API_PORT:-4002}"
exec node server/src/index.js
