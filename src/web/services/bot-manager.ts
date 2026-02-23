import { Scraper as XClient } from "@the-convocation/twitter-scraper";
import { DBType, Schema } from "db";
import { and, count, countDistinct, desc, eq, lt } from "drizzle-orm";
import { LOG_RETENTION_DAYS } from "env";
import { EventEmitter } from "events";
import { BotConfig, BotInstance, BotInstanceStatus } from "sync/bot-instance";
import { CommandPoller } from "sync/commands/command-poller";
import { CommandExecutor, SettingKey } from "sync/commands/command-types";
import { TransformRulesConfigSchema } from "sync/transforms/transform-types";
import { createTwitterClient } from "sync/x-client";
import { sendNotification } from "utils/notifications";

import { ConfigService } from "./config-service";
import { decryptJSON } from "./encryption-service";

export interface BotLogEvent {
  botId: number;
  level: "info" | "warn" | "error" | "success";
  message: string;
  platform?: string;
  tweetId?: string;
  timestamp: Date;
}

export interface BotStatusEvent {
  botId: number;
  status: BotInstanceStatus;
}

export type BotManagerEvents = {
  log: [BotLogEvent];
  statusChange: [BotStatusEvent];
  botStarted: [number];
  botStopped: [number];
};

/**
 * Manages lifecycle of multiple bot instances
 */
export class BotManager extends EventEmitter {
  private bots: Map<number, BotInstance> = new Map();
  private commandPollers: Map<number, CommandPoller> = new Map();
  private db: DBType;
  private configService: ConfigService;
  private xClient: XClient | null = null;
  private xClientPromise: Promise<XClient> | null = null;
  private pruneInterval: ReturnType<typeof setInterval> | null = null;

  constructor(db: DBType, configService: ConfigService) {
    super();
    this.db = db;
    this.configService = configService;
    // Allow many SSE clients (each adds 4 listeners)
    this.setMaxListeners(50);
  }

  /**
   * Create the shared Twitter client lazily on first bot start.
   * Uses a promise guard to prevent concurrent logins (which would
   * trigger Cloudflare detection).
   */
  private async ensureXClient(): Promise<XClient> {
    if (this.xClient) return this.xClient;
    if (this.xClientPromise) return this.xClientPromise;

    const auth = await this.configService.getTwitterAuthDecrypted();
    if (!auth) {
      throw new Error(
        "Twitter credentials not configured. Please set them in Settings.",
      );
    }

    this.xClientPromise = createTwitterClient({
      twitterUsername: auth.username,
      twitterPassword: auth.password,
      db: this.db,
    });

    try {
      this.xClient = await this.xClientPromise;
      return this.xClient;
    } finally {
      this.xClientPromise = null;
    }
  }

  /**
   * Load bot configuration from database
   */
  private async loadBotConfig(botId: number): Promise<BotConfig> {
    const botConfig = await this.db
      .select()
      .from(Schema.BotConfigs)
      .where(eq(Schema.BotConfigs.id, botId))
      .get();

    if (!botConfig) {
      throw new Error(`Bot configuration not found: ${botId}`);
    }

    const platforms = await this.db
      .select()
      .from(Schema.PlatformConfigs)
      .where(eq(Schema.PlatformConfigs.botConfigId, botId))
      .all();

    // Parse transform rules JSON
    let transformRules = null;
    if (botConfig.transformRules) {
      try {
        transformRules = TransformRulesConfigSchema.parse(
          JSON.parse(botConfig.transformRules),
        );
      } catch (_) {
        // Use null on parse failure
      }
    }

    return {
      id: Number(botConfig.id),
      twitterHandle: botConfig.twitterHandle,
      syncFrequencyMin: Number(botConfig.syncFrequencyMin),
      syncPosts: botConfig.syncPosts,
      syncProfileDescription: botConfig.syncProfileDescription,
      syncProfilePicture: botConfig.syncProfilePicture,
      syncProfileName: botConfig.syncProfileName,
      syncProfileHeader: botConfig.syncProfileHeader,
      backdateBlueskyPosts: botConfig.backdateBlueskyPosts,
      transformRules,
      platforms: platforms.map((p) => ({
        platformId: p.platformId,
        enabled: p.enabled,
        credentials: decryptJSON<Record<string, string>>(p.credentials),
      })),
    };
  }

  /**
   * Update bot status in database
   */
  private async updateBotStatusInDB(
    botId: number,
    status: BotInstanceStatus,
  ): Promise<void> {
    try {
      await this.db
        .insert(Schema.BotStatus)
        .values({
          botConfigId: botId,
          status: status.status,
          lastSyncAt: status.lastSyncAt,
          nextSyncAt: status.nextSyncAt,
          errorMessage: status.errorMessage,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: Schema.BotStatus.botConfigId,
          set: {
            status: status.status,
            lastSyncAt: status.lastSyncAt,
            nextSyncAt: status.nextSyncAt,
            errorMessage: status.errorMessage,
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      console.error(`Failed to update bot status in DB:`, error);
    }
  }

  /**
   * Save log to database
   */
  private async saveLogToDB(log: BotLogEvent): Promise<void> {
    try {
      await this.db.insert(Schema.SyncLogs).values({
        botConfigId: log.botId,
        level: log.level,
        message: log.message,
        platform: log.platform,
        tweetId: log.tweetId,
        timestamp: log.timestamp,
      });
    } catch (error) {
      console.error(`Failed to save log to DB:`, error);
    }
  }

  /**
   * Start a bot by ID
   */
  async start(botId: number): Promise<void> {
    if (this.bots.has(botId)) {
      throw new Error(`Bot ${botId} is already running`);
    }

    // Load configuration
    const config = await this.loadBotConfig(botId);

    // Ensure Twitter client is ready (creates lazily on first bot start)
    const xClient = await this.ensureXClient();

    // Create bot instance
    const bot = new BotInstance(config, this.db, xClient);

    // Set up event forwarding
    this.setupBotEvents(botId, bot);

    // Start the bot
    await bot.start();

    // Store in map
    this.bots.set(botId, bot);
    this.emit("botStarted", botId);

    // Start command poller if configured
    await this.startCommandPoller(botId, config);
  }

  /**
   * Start a command poller for a bot if commands are enabled and Bluesky is configured
   */
  private async startCommandPoller(
    botId: number,
    config: BotConfig,
  ): Promise<void> {
    try {
      // Stop existing poller if any (prevents duplicates)
      const existingPoller = this.commandPollers.get(botId);
      if (existingPoller) {
        existingPoller.stop();
        this.commandPollers.delete(botId);
      }

      const cmdConfig = await this.configService.getCommandConfig(botId);
      if (!cmdConfig || !cmdConfig.enabled) return;

      // Find Bluesky platform credentials
      const bskyPlatform = config.platforms.find(
        (p) => p.platformId === "bluesky" && p.enabled,
      );
      if (!bskyPlatform) return;

      const executor: CommandExecutor = {
        restart: async (id: number) => {
          const oldBot = this.bots.get(id);
          if (oldBot) {
            oldBot.stop();
            this.bots.delete(id);
          }
          // Reload config and restart
          try {
            const newConfig = await this.loadBotConfig(id);
            const xClient = await this.ensureXClient();
            const newBot = new BotInstance(newConfig, this.db, xClient);
            this.setupBotEvents(id, newBot);
            await newBot.start();
            this.bots.set(id, newBot);
          } catch (error) {
            // Update status so dashboard reflects the failure
            await this.updateBotStatusInDB(id, {
              status: "error",
              errorMessage:
                error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
        sync: async (id: number) => {
          const bot = this.bots.get(id);
          if (bot) await bot.triggerSync();
        },
        changeSource: async (id: number, newHandle: string) => {
          await this.configService.updateBotConfig(id, {
            twitterHandle: newHandle,
          });
          await executor.restart(id);
        },
        getSource: async (id: number) => {
          const botConfig = await this.configService.getBotConfigById(id);
          return botConfig.twitterHandle;
        },
        getStatus: async (id: number) => {
          const cfg = await this.configService.getBotConfigById(id);
          const onOff = (v: boolean) => (v ? "on" : "off");
          return [
            `@${cfg.twitterHandle} settings:`,
            `Frequency: ${cfg.syncFrequencyMin} min`,
            `Posts: ${onOff(cfg.syncPosts)} | Bio: ${onOff(cfg.syncProfileDescription)} | Avatar: ${onOff(cfg.syncProfilePicture)}`,
            `Name: ${onOff(cfg.syncProfileName)} | Header: ${onOff(cfg.syncProfileHeader)} | Backdate: ${onOff(cfg.backdateBlueskyPosts)}`,
          ].join("\n");
        },
        setSetting: async (id: number, key: SettingKey, value: unknown) => {
          const fieldMap: Record<SettingKey, string> = {
            frequency: "syncFrequencyMin",
            posts: "syncPosts",
            bio: "syncProfileDescription",
            avatar: "syncProfilePicture",
            name: "syncProfileName",
            header: "syncProfileHeader",
            backdate: "backdateBlueskyPosts",
          };
          const field = fieldMap[key];
          await this.configService.updateBotConfig(id, {
            [field]: value,
          });
        },
        mute: async (id: number) => {
          const bot = this.bots.get(id);
          if (bot) bot.mute();
        },
        unmute: async (id: number) => {
          const bot = this.bots.get(id);
          if (bot) bot.unmute();
        },
        getLastPost: async (id: number) => {
          // Find the most recent success log with a tweetId for bluesky
          const log = await this.db
            .select()
            .from(Schema.SyncLogs)
            .where(
              and(
                eq(Schema.SyncLogs.botConfigId, id),
                eq(Schema.SyncLogs.level, "success"),
                eq(Schema.SyncLogs.platform, "bluesky"),
              ),
            )
            .orderBy(desc(Schema.SyncLogs.timestamp))
            .limit(20)
            .all();

          // Find first log with a tweetId
          const withTweet = log.find((l) => l.tweetId);
          if (!withTweet?.tweetId) return null;

          // Look up TweetMap for the bluesky rkey
          const mapEntry = await this.db
            .select()
            .from(Schema.TweetMap)
            .where(
              and(
                eq(Schema.TweetMap.tweetId, withTweet.tweetId),
                eq(Schema.TweetMap.platform, "bluesky"),
              ),
            )
            .get();

          if (!mapEntry?.platformStore) return null;

          try {
            const store = JSON.parse(mapEntry.platformStore);
            const rkey = store.rkey;
            const uri = store.uri;
            const cid = store.cid;
            if (!rkey) return null;

            // Get the bot's bluesky handle to construct URL
            const botConfig = await this.configService.getBotConfigById(id);
            const bskyPlatform = botConfig.platforms.find(
              (p) => p.platformId === "bluesky",
            );
            const handle =
              bskyPlatform?.credentials["BLUESKY_IDENTIFIER"] ?? "";

            return {
              url: `https://bsky.app/profile/${handle}/post/${rkey}`,
              uri: uri ?? "",
              cid: cid ?? "",
            };
          } catch (_) {
            return null;
          }
        },
        getStats: async (id: number) => {
          const bot = this.bots.get(id);
          const status = bot?.getStatus();

          // Count logs by level
          const successCount = await this.db
            .select({ value: count() })
            .from(Schema.SyncLogs)
            .where(
              and(
                eq(Schema.SyncLogs.botConfigId, id),
                eq(Schema.SyncLogs.level, "success"),
              ),
            )
            .get();

          const errorCount = await this.db
            .select({ value: count() })
            .from(Schema.SyncLogs)
            .where(
              and(
                eq(Schema.SyncLogs.botConfigId, id),
                eq(Schema.SyncLogs.level, "error"),
              ),
            )
            .get();

          // Count distinct synced tweets
          const tweetCount = await this.db
            .select({ value: countDistinct(Schema.SyncLogs.tweetId) })
            .from(Schema.SyncLogs)
            .where(
              and(
                eq(Schema.SyncLogs.botConfigId, id),
                eq(Schema.SyncLogs.level, "success"),
              ),
            )
            .get();

          const isMuted = bot?.muted ?? false;
          const lastSync = status?.lastSyncAt
            ? status.lastSyncAt.toISOString()
            : "never";
          const nextSync = status?.nextSyncAt
            ? status.nextSyncAt.toISOString()
            : "n/a";

          return [
            `Muted: ${isMuted ? "yes" : "no"}`,
            `Synced tweets: ${tweetCount?.value ?? 0}`,
            `Success logs: ${successCount?.value ?? 0}`,
            `Error logs: ${errorCount?.value ?? 0}`,
            `Last sync: ${lastSync}`,
            `Next sync: ${nextSync}`,
          ].join("\n");
        },
      };

      const poller = new CommandPoller({
        botId,
        config: cmdConfig,
        credentials: {
          instance:
            bskyPlatform.credentials["BLUESKY_INSTANCE"] || "bsky.social",
          identifier: bskyPlatform.credentials["BLUESKY_IDENTIFIER"],
          password: bskyPlatform.credentials["BLUESKY_PASSWORD"],
        },
        executor,
        lastSeenAt: cmdConfig.lastSeenAt,
        onLastSeenAtUpdate: (id, ts) =>
          this.configService.updateLastSeenAt(id, ts),
        onConfigRefresh: (id) => this.configService.getCommandConfig(id),
      });

      // Forward log events
      poller.on("log", (logData) => {
        const log: BotLogEvent = {
          botId,
          ...logData,
          timestamp: new Date(),
        };
        this.emit("log", log);
        this.saveLogToDB(log);
      });

      await poller.start();
      this.commandPollers.set(botId, poller);
    } catch (error) {
      console.error(`Failed to start command poller for bot ${botId}:`, error);
    }
  }

  /**
   * Set up event forwarding for a bot instance
   */
  private setupBotEvents(botId: number, bot: BotInstance): void {
    bot.on("log", (logData) => {
      const log: BotLogEvent = {
        botId,
        ...logData,
        timestamp: new Date(),
      };
      this.emit("log", log);
      this.saveLogToDB(log);
    });

    bot.on("statusChange", (status) => {
      const statusEvent: BotStatusEvent = { botId, status };
      this.emit("statusChange", statusEvent);
      this.updateBotStatusInDB(botId, status);
    });

    bot.on("error", (error) => {
      sendNotification(
        `Bot ${botId} error`,
        error instanceof Error ? error.message : String(error),
        "failure",
        `bot-error-${botId}`,
      );
    });
  }

  /**
   * Stop a bot by ID
   */
  stop(botId: number): void {
    const bot = this.bots.get(botId);
    if (!bot) {
      throw new Error(`Bot ${botId} is not running`);
    }

    // Stop command poller
    const poller = this.commandPollers.get(botId);
    if (poller) {
      poller.stop();
      this.commandPollers.delete(botId);
    }

    bot.stop();
    this.bots.delete(botId);
    this.emit("botStopped", botId);
  }

  /**
   * Start all enabled bots
   */
  async startAll(): Promise<void> {
    const allBots = await this.db
      .select()
      .from(Schema.BotConfigs)
      .where(eq(Schema.BotConfigs.enabled, true))
      .all();

    for (const botConfig of allBots) {
      const id = Number(botConfig.id);
      try {
        if (!this.bots.has(id)) {
          await this.start(id);
        }
      } catch (error) {
        console.error(`Failed to start bot ${id}:`, error);
        sendNotification(
          `Bot ${id} failed to start`,
          error instanceof Error ? error.message : String(error),
          "failure",
          `bot-start-${id}`,
        );
        // Continue with other bots
      }
    }
  }

  /**
   * Delete sync_logs older than LOG_RETENTION_DAYS
   */
  private async pruneOldLogs(): Promise<void> {
    if (LOG_RETENTION_DAYS < 0) return;
    try {
      const cutoff = new Date(
        Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const result = await this.db
        .delete(Schema.SyncLogs)
        .where(lt(Schema.SyncLogs.timestamp, cutoff));
      const deleted = result.changes;
      if (deleted > 0) {
        console.log(
          `Pruned ${deleted} log(s) older than ${LOG_RETENTION_DAYS} day(s)`,
        );
      }
    } catch (error) {
      console.error("Failed to prune old logs:", error);
    }
  }

  /**
   * Start periodic log pruning (runs immediately, then every 24 hours)
   */
  startLogPruning(): void {
    this.pruneOldLogs();
    this.pruneInterval = setInterval(
      () => this.pruneOldLogs(),
      24 * 60 * 60 * 1000,
    );
  }

  /**
   * Stop all running bots
   */
  stopAll(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
    // Stop all command pollers
    for (const [botId, poller] of this.commandPollers.entries()) {
      try {
        poller.stop();
        this.commandPollers.delete(botId);
      } catch (error) {
        console.error(`Failed to stop command poller ${botId}:`, error);
      }
    }
    for (const [botId, bot] of this.bots.entries()) {
      try {
        bot.stop();
        this.bots.delete(botId);
        this.emit("botStopped", botId);
      } catch (error) {
        console.error(`Failed to stop bot ${botId}:`, error);
      }
    }
  }

  /**
   * Get status of a specific bot
   */
  getStatus(botId: number): BotInstanceStatus | null {
    const bot = this.bots.get(botId);
    return bot ? bot.getStatus() : null;
  }

  /**
   * Get status of all bots
   */
  async getAllStatus(): Promise<
    Array<{
      botId: number;
      config: BotConfig;
      status: BotInstanceStatus | null;
    }>
  > {
    const allBots = await this.db.select().from(Schema.BotConfigs).all();

    return allBots.map((botConfig) => {
      const id = Number(botConfig.id);
      const bot = this.bots.get(id);
      return {
        botId: id,
        config: {
          id,
          twitterHandle: botConfig.twitterHandle,
          syncFrequencyMin: Number(botConfig.syncFrequencyMin),
          syncPosts: botConfig.syncPosts,
          syncProfileDescription: botConfig.syncProfileDescription,
          syncProfilePicture: botConfig.syncProfilePicture,
          syncProfileName: botConfig.syncProfileName,
          syncProfileHeader: botConfig.syncProfileHeader,
          backdateBlueskyPosts: botConfig.backdateBlueskyPosts,
          platforms: [],
        },
        status: bot ? bot.getStatus() : null,
      };
    });
  }

  /**
   * Check if a bot is running
   */
  isRunning(botId: number): boolean {
    return this.bots.has(botId);
  }
}
