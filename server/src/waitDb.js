import pg from 'pg';

const {
  PGHOST = 'db',
  PGPORT = '5432',
  PGUSER = 'postgres',
  PGPASSWORD = '',
  PGDATABASE = 'cashier',
} = process.env;

const maxAttempts = 60;

async function wait() {
  for (let i = 1; i <= maxAttempts; i++) {
    const client = new pg.Client({
      host: PGHOST,
      port: Number(PGPORT),
      user: PGUSER,
      password: PGPASSWORD,
      database: PGDATABASE,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      console.log(`PostgreSQL ready (${PGHOST}:${PGPORT}/${PGDATABASE})`);
      return;
    } catch (err) {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
      console.log(`DB not ready (${i}/${maxAttempts}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error('PostgreSQL did not become ready in time');
  process.exit(1);
}

await wait();
