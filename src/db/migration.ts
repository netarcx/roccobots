import { DBType } from "db";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import * as v1 from "./schema/v1";
import * as v2 from "./schema/v2";

export const schemas = [{}, v1, v2];
// export const latestSchema = schemas[schemas.length - 1];

export async function migrate(
  db: BunSQLiteDatabase<{ Version: typeof v1.Version }>,
): Promise<DBType> {
  let currentVersion: number = 0;
  try {
    // 1. Try to get the current version.
    // This will fail if the table or row doesn't exist.
    const result = db.select().from(v1.Version).get();
    currentVersion = result?.version || 0;
    console.log(`Current database version: ${currentVersion}`);
  } catch (_) {
    // 2. If it fails, assume version 0.
    console.log("Could not determine database version, assuming 0.");
  }
  // Fix Bigint issue
  currentVersion = Number(currentVersion);

  for (let i = currentVersion + 1; i < schemas.length; i++) {
    const prevSchema = schemas[i - 1];
    const currSchema = schemas[i];

    console.log(`Generating migration from v${i - 1} to v${i}...`);

    const migrationStatements = await generateSQLiteMigration(
      await generateSQLiteDrizzleJson(prevSchema),
      await generateSQLiteDrizzleJson(currSchema),
    );

    if (migrationStatements.length === 0) {
      console.log("No schema changes detected.");
      continue;
    }

    try {
      // Run all migration statements within a transaction
      for (const s of migrationStatements) {
        console.log("Executing: ", s);
        db.run(s);
      }
      // 4. Update the version in the database
      // Ensure the table exists
      db.run(
        "CREATE TABLE IF NOT EXISTS version (id INTEGER PRIMARY KEY, version INTEGER);",
      );
      // Use INSERT OR REPLACE (UPSERT) to set the new version
      db.run(`INSERT OR REPLACE INTO version (id, version) VALUES (1, ${i})`);
      console.log(`✅ Migrated successfully to version ${i}`);
    } catch (e) {
      console.error(`Migration to v${i} failed:`, e);
      // If a migration fails, stop the process
      // return;
      throw new Error("Migration failed...");
    }
  }

  if (currentVersion === schemas.length - 1) {
    console.log("Database is already up to date.");
  }

  // Drop legacy unique index on twitter_handle (allows multiple bots per handle)
  try {
    db.run(
      "DROP INDEX IF EXISTS bot_configs_twitter_handle_unique",
    );
  } catch (_) {
    // Ignore if index doesn't exist
  }

  // Backfill twitter_auth from first bot's credentials if table is empty
  try {
    const authCount = db
      .all("SELECT COUNT(*) as count FROM twitter_auth") as any[];
    if (authCount[0]?.count === 0 || authCount[0]?.["COUNT(*)"] === 0) {
      const firstBot = db
        .all(
          "SELECT twitter_username, twitter_password FROM bot_configs ORDER BY id ASC LIMIT 1",
        ) as any[];
      if (firstBot.length > 0 && firstBot[0].twitter_username && firstBot[0].twitter_password) {
        const now = Date.now();
        db.run(
          `INSERT INTO twitter_auth (id, username, password, created_at, updated_at) VALUES (1, '${firstBot[0].twitter_username}', '${firstBot[0].twitter_password}', ${now}, ${now})`,
        );
        console.log("✅ Backfilled twitter_auth from first bot's credentials");
      }
    }
  } catch (_) {
    // Table may not exist yet if migration just created it — that's fine
  }

  return db as DBType;
}
