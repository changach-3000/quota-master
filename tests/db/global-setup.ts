import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../prisma/migrations");

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const dbName = new URL(url).pathname.slice(1);
  // Guard: this setup wipes the schema, so it must never point at a real database.
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to reset "${dbName}": test database name must end in _test`);
  }
  return url;
}

// Rebuild the test schema from the migration files before the run.
export default async function setup() {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const name of migrations) {
      await client.query(readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"));
    }
  } finally {
    await client.end();
  }
}
