import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db";

const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrate() {
  await pool.query(`
    create table if not exists schema_migration (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const applied = await pool.query(
      "select 1 from schema_migration where version = $1",
      [file],
    );
    if (applied.rowCount) continue;

    const sql = await readFile(join(migrationDirectory, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into schema_migration(version) values ($1) on conflict do nothing",
        [file],
      );
      await client.query("commit");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
