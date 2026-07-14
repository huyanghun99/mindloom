import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './client';
async function main() {
    const sql = readFileSync(join(process.cwd(), 'src/db/migrations/0001_init.sql'), 'utf8');
    await pool.query(sql);
    await pool.end();
    console.log('Migrations applied');
}
main().catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
});
