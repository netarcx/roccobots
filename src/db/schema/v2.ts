import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Re-export v1 tables
export * from "./v1";

/**
 * Bot configurations - stores Twitter account credentials and sync settings
 */
export const BotConfigs = sqliteTable("bot_configs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  twitterHandle: text("twitter_handle").notNull(),
  twitterUsername: text("twitter_username").notNull(),
  twitterPassword: text("twitter_password").notNull(), // encrypted
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  syncFrequencyMin: integer("sync_frequency_min").notNull().default(30),
  syncPosts: integer("sync_posts", { mode: "boolean" }).notNull().default(true),
  syncProfileDescription: integer("sync_profile_description", {
    mode: "boolean",
  })
    .notNull()
    .default(true),
  syncProfilePicture: integer("sync_profile_picture", { mode: "boolean" })
    .notNull()
    .default(true),
  syncProfileName: integer("sync_profile_name", { mode: "boolean" })
    .notNull()
    .default(true),
  syncProfileHeader: integer("sync_profile_header", { mode: "boolean" })
    .notNull()
    .default(true),
  backdateBlueskyPosts: integer("backdate_bluesky_posts", { mode: "boolean" })
    .notNull()
    .default(true),
  transformRules: text("transform_rules"), // JSON TransformRulesConfig
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Platform configurations - stores credentials for each platform per bot
 */
export const PlatformConfigs = sqliteTable(
  "platform_configs",
  {
    botConfigId: integer("bot_config_id")
      .notNull()
      .references(() => BotConfigs.id, { onDelete: "cascade" }),
    platformId: text("platform_id").notNull(), // "bluesky", "mastodon", "misskey", "discord"
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    credentials: text("credentials").notNull(), // JSON encrypted
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.botConfigId, t.platformId] })],
);

/**
 * Sync logs - historical record of sync operations
 */
export const SyncLogs = sqliteTable("sync_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  botConfigId: integer("bot_config_id")
    .notNull()
    .references(() => BotConfigs.id, { onDelete: "cascade" }),
  level: text("level").notNull(), // "info", "warn", "error", "success"
  message: text("message").notNull(),
  platform: text("platform"), // nullable - for general bot logs
  tweetId: text("tweet_id"), // nullable
  metadata: text("metadata"), // JSON for additional context
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Bot status - current runtime status of each bot
 */
export const BotStatus = sqliteTable("bot_status", {
  botConfigId: integer("bot_config_id")
    .primaryKey()
    .references(() => BotConfigs.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("stopped"), // "running", "stopped", "error"
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
  nextSyncAt: integer("next_sync_at", { mode: "timestamp" }),
  errorMessage: text("error_message"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Twitter auth - global Twitter login credentials (single row)
 */
export const TwitterAuth = sqliteTable("twitter_auth", {
  id: integer("id").primaryKey().default(1),
  username: text("username").notNull(),
  password: text("password").notNull(), // encrypted
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Command configs - per-bot Bluesky command handler settings
 */
export const CommandConfigs = sqliteTable("command_configs", {
  botConfigId: integer("bot_config_id")
    .primaryKey()
    .references(() => BotConfigs.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  trustedHandles: text("trusted_handles").notNull().default("[]"), // JSON array of Bluesky handles
  pollIntervalSec: integer("poll_interval_sec").notNull().default(60),
  responseMessages: text("response_messages"), // JSON ResponseMessages, nullable (null = defaults)
  lastSeenAt: text("last_seen_at"), // ISO timestamp for notification dedup
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Web sessions - session storage for web interface authentication
 */
export const WebSessions = sqliteTable("web_sessions", {
  id: text("id").primaryKey(),
  data: text("data").notNull(), // JSON session data
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
