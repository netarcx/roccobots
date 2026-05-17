import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
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
  analyticsEnabled: integer("analytics_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  adaptivePolling: integer("adaptive_polling", { mode: "boolean" })
    .notNull()
    .default(false),
  mentionOverrides: text("mention_overrides"), // JSON { [twitterHandleLower]: blueskyHandle } — nullable; missing keys fall back to global
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
    platformId: text("platform_id").notNull(), // "bluesky", "misskey", "discord"
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
 * Tweet metrics - Bluesky engagement stats for synced posts
 */
export const TweetMetrics = sqliteTable(
  "tweet_metrics",
  {
    tweetId: text("tweet_id").notNull(),
    botConfigId: integer("bot_config_id")
      .notNull()
      .references(() => BotConfigs.id, { onDelete: "cascade" }),
    blueskyLikes: integer("bluesky_likes").notNull().default(0),
    blueskyReposts: integer("bluesky_reposts").notNull().default(0),
    blueskyReplies: integer("bluesky_replies").notNull().default(0),
    blueskyQuotes: integer("bluesky_quotes").notNull().default(0),
    recordedAt: integer("recorded_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.tweetId, t.botConfigId] })],
);

/**
 * Global mention overrides - shared across bots. Rewrites @twitterHandle →
 * @blueskyHandle when a bot posts to Bluesky. Per-bot overrides
 * (bot_configs.mention_overrides) take precedence; absent keys fall back here.
 */
export const MentionOverrides = sqliteTable("mention_overrides", {
  twitterHandle: text("twitter_handle").primaryKey(), // lowercased for case-insensitive lookup
  blueskyHandle: text("bluesky_handle").notNull(),
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

/**
 * Users - web dashboard user accounts with role-based access
 */
export const Users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("viewer"), // "admin" | "viewer"
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Notification preferences - per-bot or global event notification toggles
 */
export const NotificationPreferences = sqliteTable(
  "notification_preferences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    botConfigId: integer("bot_config_id").references(() => BotConfigs.id, {
      onDelete: "cascade",
    }),
    eventType: text("event_type").notNull(), // "sync_error", "bot_stopped", "health_alert"
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [uniqueIndex("notif_pref_unique").on(t.botConfigId, t.eventType)],
);

/**
 * Blackout windows - scheduled quiet hours per bot
 */
export const BlackoutWindows = sqliteTable("blackout_windows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  botConfigId: integer("bot_config_id")
    .notNull()
    .references(() => BotConfigs.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week"), // 0=Sun..6=Sat, null = every day
  startHour: integer("start_hour").notNull(),
  startMinute: integer("start_minute").notNull().default(0),
  endHour: integer("end_hour").notNull(),
  endMinute: integer("end_minute").notNull().default(0),
});

/**
 * Log archives - metadata for archived log files
 */
export const LogArchives = sqliteTable("log_archives", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  fromDate: integer("from_date", { mode: "timestamp" }).notNull(),
  toDate: integer("to_date", { mode: "timestamp" }).notNull(),
  rowCount: integer("row_count").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
