import { EventEmitter } from "events";
import { DBType, Schema } from "db";
import { BotInstance, BotConfig, BotInstanceStatus } from "sync/bot-instance";
import { Scraper as XClient } from "@the-convocation/twitter-scraper";
import { createTwitterClient } from "sync/x-client";
import { eq } from "drizzle-orm";
import { decryptJSON, decrypt } from "./encryption-service";

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
  private db: DBType;
  private xClient: XClient | null = null;
  private xClientPromise: Promise<XClient> | null = null;

  constructor(db: DBType) {
    super();
    this.db = db;
  }

  /**
   * Create the shared Twitter client lazily on first bot start.
   * Uses a promise guard to prevent concurrent logins (which would
   * trigger Cloudflare detection).
   */
  private async ensureXClient(config: BotConfig): Promise<XClient> {
    if (this.xClient) return this.xClient;
    if (this.xClientPromise) return this.xClientPromise;

    this.xClientPromise = createTwitterClient({
      twitterUsername: config.twitterUsername,
      twitterPassword: config.twitterPassword,
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

    return {
      id: Number(botConfig.id),
      twitterHandle: botConfig.twitterHandle,
      twitterUsername: botConfig.twitterUsername,
      twitterPassword: decrypt(botConfig.twitterPassword),
      syncFrequencyMin: Number(botConfig.syncFrequencyMin),
      syncPosts: botConfig.syncPosts,
      syncProfileDescription: botConfig.syncProfileDescription,
      syncProfilePicture: botConfig.syncProfilePicture,
      syncProfileName: botConfig.syncProfileName,
      syncProfileHeader: botConfig.syncProfileHeader,
      backdateBlueskyPosts: botConfig.backdateBlueskyPosts,
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
    const xClient = await this.ensureXClient(config);

    // Create bot instance
    const bot = new BotInstance(config, this.db, xClient);

    // Set up event forwarding
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

    // Start the bot
    await bot.start();

    // Store in map
    this.bots.set(botId, bot);
    this.emit("botStarted", botId);
  }

  /**
   * Stop a bot by ID
   */
  stop(botId: number): void {
    const bot = this.bots.get(botId);
    if (!bot) {
      throw new Error(`Bot ${botId} is not running`);
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
        // Continue with other bots
      }
    }
  }

  /**
   * Stop all running bots
   */
  stopAll(): void {
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
    Array<{ botId: number; config: BotConfig; status: BotInstanceStatus | null }>
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
          twitterUsername: botConfig.twitterUsername,
          twitterPassword: "", // Don't expose password
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
