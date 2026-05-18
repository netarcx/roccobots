import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { DBType } from "db";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { DATABASE_PATH } from "env";

import * as v1 from "./schema/v1";
import * as v2 from "./schema/v2";

export const schemas = [{}, v1, v2];
// export const latestSchema = schemas[schemas.length - 1];

export async function migrate(
  db: BunSQLiteDatabase<{ Version: typeof v1.Version }>,
): Promise<DBType> {
  // Create a backup before running any migrations
  try {
    if (existsSync(DATABASE_PATH)) {
      const backupDir = join(dirname(DATABASE_PATH), "backups");
      mkdirSync(backupDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      copyFileSync(
        DATABASE_PATH,
        join(backupDir, `pre-migration-${ts}.sqlite`),
      );
      const existing = readdirSync(backupDir)
        .filter((f) => f.startsWith("pre-migration-"))
        .sort();
      while (existing.length > 5) {
        unlinkSync(join(backupDir, existing.shift()!));
      }
    }
  } catch (_) {
    // Non-fatal — migration proceeds even if backup fails
  }

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
    db.run("DROP INDEX IF EXISTS bot_configs_twitter_handle_unique");
  } catch (_) {
    // Ignore if index doesn't exist
  }

  // Ensure twitter_auth table exists (added after v2 schema was already deployed)
  db.run(`CREATE TABLE IF NOT EXISTS twitter_auth (
    id integer PRIMARY KEY DEFAULT 1,
    username text NOT NULL,
    password text NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`);

  // Add transform_rules column to bot_configs (added after initial v2 deployment)
  try {
    db.run("ALTER TABLE bot_configs ADD COLUMN transform_rules TEXT");
  } catch (_) {
    // Column already exists
  }

  // Ensure command_configs table exists
  db.run(`CREATE TABLE IF NOT EXISTS command_configs (
    bot_config_id integer PRIMARY KEY REFERENCES bot_configs(id) ON DELETE CASCADE,
    enabled integer NOT NULL DEFAULT 0,
    trusted_handles text NOT NULL DEFAULT '[]',
    poll_interval_sec integer NOT NULL DEFAULT 60,
    response_messages text,
    last_seen_at text,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`);

  // Backfill twitter_auth from first bot's credentials if table is empty
  try {
    const authCount = db.all(
      "SELECT COUNT(*) as count FROM twitter_auth",
    ) as any[];
    if (authCount[0]?.count === 0 || authCount[0]?.["COUNT(*)"] === 0) {
      const firstBot = db.all(
        "SELECT twitter_username, twitter_password FROM bot_configs ORDER BY id ASC LIMIT 1",
      ) as any[];
      if (
        firstBot.length > 0 &&
        firstBot[0].twitter_username &&
        firstBot[0].twitter_password
      ) {
        const now = Math.floor(Date.now() / 1000);
        db.run(
          sql`INSERT INTO twitter_auth (id, username, password, created_at, updated_at) VALUES (1, ${firstBot[0].twitter_username}, ${firstBot[0].twitter_password}, ${now}, ${now})`,
        );
        console.log("✅ Backfilled twitter_auth from first bot's credentials");
      }
    }
  } catch (_) {
    // Table may not exist yet if migration just created it — that's fine
  }

  // Add analytics_enabled column to bot_configs (opt-out of analytics per bot)
  try {
    db.run(
      "ALTER TABLE bot_configs ADD COLUMN analytics_enabled INTEGER NOT NULL DEFAULT 1",
    );
  } catch (_) {
    // Column already exists
  }

  // Ensure tweet_metrics table exists (Bluesky engagement analytics)
  db.run(`CREATE TABLE IF NOT EXISTS tweet_metrics (
    tweet_id text NOT NULL,
    bot_config_id integer NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
    bluesky_likes integer NOT NULL DEFAULT 0,
    bluesky_reposts integer NOT NULL DEFAULT 0,
    bluesky_replies integer NOT NULL DEFAULT 0,
    bluesky_quotes integer NOT NULL DEFAULT 0,
    recorded_at integer NOT NULL,
    PRIMARY KEY (tweet_id, bot_config_id)
  )`);

  // Add adaptive_polling column to bot_configs (opt-in per-bot)
  try {
    db.run(
      "ALTER TABLE bot_configs ADD COLUMN adaptive_polling INTEGER NOT NULL DEFAULT 0",
    );
  } catch (_) {
    // Column already exists
  }

  // Add mention_overrides JSON column to bot_configs (per-bot @-rewrite map)
  try {
    db.run("ALTER TABLE bot_configs ADD COLUMN mention_overrides TEXT");
  } catch (_) {
    // Column already exists
  }

  // Global @-rewrite map shared across all bots
  db.run(`CREATE TABLE IF NOT EXISTS mention_overrides (
    twitter_handle text PRIMARY KEY,
    bluesky_handle text NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`);

  // Users table for multi-user auth (Feature 9)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id integer PRIMARY KEY AUTOINCREMENT,
    username text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'viewer',
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`);

  // Notification preferences (Feature 8)
  db.run(`CREATE TABLE IF NOT EXISTS notification_preferences (
    id integer PRIMARY KEY AUTOINCREMENT,
    bot_config_id integer REFERENCES bot_configs(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    enabled integer NOT NULL DEFAULT 1,
    UNIQUE(bot_config_id, event_type)
  )`);

  // Add timezone column to bot_configs (defaults to America/Chicago)
  try {
    db.run(
      "ALTER TABLE bot_configs ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Chicago'",
    );
  } catch (_) {
    // Column already exists
  }

  // Blackout windows (Feature 12)
  db.run(`CREATE TABLE IF NOT EXISTS blackout_windows (
    id integer PRIMARY KEY AUTOINCREMENT,
    bot_config_id integer NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
    day_of_week integer,
    start_hour integer NOT NULL,
    start_minute integer NOT NULL DEFAULT 0,
    end_hour integer NOT NULL,
    end_minute integer NOT NULL DEFAULT 0
  )`);

  // Log archives metadata (Feature 20)
  db.run(`CREATE TABLE IF NOT EXISTS log_archives (
    id integer PRIMARY KEY AUTOINCREMENT,
    filename text NOT NULL,
    from_date integer NOT NULL,
    to_date integer NOT NULL,
    row_count integer NOT NULL,
    size_bytes integer NOT NULL,
    created_at integer NOT NULL
  )`);

  return db as DBType;
}
