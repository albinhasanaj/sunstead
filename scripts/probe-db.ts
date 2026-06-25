/**
 * Step 1(b)+(c): prove the Aiven Postgres infra.
 *   - connects over TLS using the Aiven CA cert
 *   - SELECT 1 + server version
 *   - CREATE EXTENSION vector (confirms pgvector is allowed on this plan)
 *   - exercises the `<=>` distance operator on a real vector
 *
 * Env (put in .env.local, do NOT commit):
 *   DATABASE_URL   postgres://avnadmin:***@<host>:<port>/defaultdb?sslmode=require
 *   AIVEN_CA_PATH  absolute path to the downloaded Aiven ca.pem
 *
 * Run:  npx tsx scripts/probe-db.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
loadEnv({ path: '.env.local' });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL is not set in .env.local — provision the Aiven service first.');
    process.exit(1);
  }

  const caPath = process.env.AIVEN_CA_PATH;
  let ssl: any;
  if (caPath) {
    try {
      ssl = { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
      console.log(`🔒 Using CA from ${caPath} (verify-full).`);
    } catch (e) {
      console.error(`❌ Could not read AIVEN_CA_PATH (${caPath}): ${(e as Error).message}`);
      process.exit(1);
    }
  } else {
    ssl = { rejectUnauthorized: false };
    console.warn('⚠  AIVEN_CA_PATH not set — connecting TLS WITHOUT verifying the CA (smoke test only).');
  }

  const host = (() => { try { return new URL(url).host; } catch { return '(unparseable url)'; } })();
  const client = new Client({ connectionString: url, ssl });

  try {
    const t0 = Date.now();
    await client.connect();
    console.log(`✅ (b) Connected over TLS to ${host} in ${Date.now() - t0}ms`);

    const one = await client.query('SELECT 1 AS ok');
    console.log(`✅ (b) SELECT 1 → ${one.rows[0].ok}`);

    const ver = await client.query('SELECT version()');
    console.log(`   server: ${String(ver.rows[0].version).split(' ').slice(0, 2).join(' ')}`);

    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    const ext = await client.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
    if (!ext.rows.length) throw new Error('vector extension not present after CREATE EXTENSION');
    console.log(`✅ (c) pgvector enabled — version ${ext.rows[0].extversion}`);

    const dist = await client.query("SELECT '[1,0,0]'::vector <=> '[0,1,0]'::vector AS cos");
    console.log(`✅ (c) '<=>' operator works → cosine distance ${dist.rows[0].cos}`);

    console.log('\nRESULT: infra OK — ready for step 2.');
  } catch (e) {
    console.error(`\n❌ FAILED: ${(e as Error).message}`);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
