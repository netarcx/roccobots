import { DBType } from "db";
import { Scraper as XClient } from "@the-convocation/twitter-scraper";
import { BlueskySynchronizerFactory } from "sync/platforms/bluesky";
import { MastodonSynchronizerFactory } from "sync/platforms/mastodon/mastodon-sync";
import { MisskeySynchronizerFactory } from "sync/platforms/misskey/missky-sync";
import { DiscordWebhookSynchronizerFactory } from "sync/platforms/discord-webhook/webhook-sync";
import { syncPosts } from "sync/sync-posts";
import { syncProfile } from "sync/sync-profile";
import { TaggedSynchronizer, SynchronizerFactory } from "sync/synchronizer";
import ora, { Ora } from "ora";
import { EventEmitter } from "events";

export interface BotConfig {
  id: number;
  twitterHandle: string;
  syncFrequencyMin: number;
  syncPosts: boolean;
  syncProfileDescription: boolean;
  syncProfilePicture: boolean;
  syncProfileName: boolean;
  syncProfileHeader: boolean;
  backdateBlueskyPosts: boolean;
  platforms: {
    platformId: string;
    enabled: boolean;
    credentials: Record<string, string>;
  }[];
}

export interface BotInstanceStatus {
  status: "running" | "stopped" | "error";
  lastSyncAt?: Date;
  nextSyncAt?: Date;
  errorMessage?: string;
}

export type BotInstanceEvents = {
  log: [
    {
      level: "info" | "warn" | "error" | "success";
      message: string;
      platform?: string;
      tweetId?: string;
    },
  ];
  statusChange: [BotInstanceStatus];
  syncComplete: [];
  error: [Error];
};

/**
 * Represents a single bot instance that can sync posts from Twitter to other platforms
 */
export class BotInstance extends EventEmitter {
  private config: BotConfig;
  private db: DBType;
  private xClient: XClient;
  private synchronizers: TaggedSynchronizer[] = [];
  private syncInterval: NodeJS.Timeout | null = null;
  private status: BotInstanceStatus = {
    status: "stopped",
  };
  private isRunning = false;

  constructor(config: BotConfig, db: DBType, xClient: XClient) {
    super();
    this.config = config;
    this.db = db;
    this.xClient = xClient;
  }

  /**
   * Initialize synchronizers for all enabled platforms
   */
  private async initializeSynchronizers(): Promise<void> {
    const factories = [
      BlueskySynchronizerFactory,
      MastodonSynchronizerFactory,
      MisskeySynchronizerFactory,
      DiscordWebhookSynchronizerFactory,
    ] as const;

    this.synchronizers = [];

    for (const platform of this.config.platforms) {
      if (!platform.enabled) {
        continue;
      }

      const factory = factories.find((f) => f.PLATFORM_ID === platform.platformId);
      if (!factory) {
        this.emitLog(
          "warn",
          `Unknown platform: ${platform.platformId}`,
          platform.platformId,
        );
        continue;
      }

      try {
        const log = ora({
          color: "gray",
          text: `Connecting to ${factory.DISPLAY_NAME}`,
        }).start();

        // Merge factory fallback values (e.g. BLUESKY_INSTANCE defaults)
        const env = { ...factory.FALLBACK_ENV, ...platform.credentials } as any;

        const synchronizer = await factory.create({
          xClient: this.xClient,
          env,
          db: this.db,
          slot: this.config.id,
          log,
        });

        this.synchronizers.push({
          ...synchronizer,
          displayName: factory.DISPLAY_NAME,
          emoji: factory.EMOJI,
          platformId: factory.PLATFORM_ID,
          storeSchema: factory.STORE_SCHEMA,
        });

        log.succeed(`Connected to ${factory.DISPLAY_NAME}`);
        this.emitLog("success", `Connected to ${factory.DISPLAY_NAME}`, platform.platformId);
      } catch (error) {
        this.emitLog(
          "error",
          `Failed to connect to ${factory.DISPLAY_NAME}: ${error}`,
          platform.platformId,
        );
      }
    }
  }

  /**
   * Emit a log event
   */
  private emitLog(
    level: "info" | "warn" | "error" | "success",
    message: string,
    platform?: string,
    tweetId?: string,
  ): void {
    this.emit("log", { level, message, platform, tweetId });
  }

  /**
   * Update and emit status change
   */
  private updateStatus(status: Partial<BotInstanceStatus>): void {
    this.status = { ...this.status, ...status };
    this.emit("statusChange", this.status);
  }

  /**
   * Perform a sync cycle
   */
  private async performSync(): Promise<void> {
    try {
      this.emitLog("info", `Starting sync for @${this.config.twitterHandle}`);

      // Sync profile
      await syncProfile({
        x: this.xClient,
        twitterHandle: {
          handle: this.config.twitterHandle,
          postFix: this.config.id,
          slot: this.config.id,
          env: `TWITTER_HANDLE${this.config.id}` as any,
        },
        synchronizers: this.synchronizers,
        db: this.db,
      });

      // Sync posts if enabled
      if (this.config.syncPosts) {
        await syncPosts({
          db: this.db,
          handle: {
            handle: this.config.twitterHandle,
            postFix: this.config.id,
            slot: this.config.id,
            env: `TWITTER_HANDLE${this.config.id}` as any,
          },
          x: this.xClient,
          synchronizers: this.synchronizers,
        });
      } else {
        this.emitLog("info", "Post syncing is disabled");
      }

      const now = new Date();
      const nextSync = new Date(now.getTime() + this.config.syncFrequencyMin * 60 * 1000);

      this.updateStatus({
        status: "running",
        lastSyncAt: now,
        nextSyncAt: nextSync,
        errorMessage: undefined,
      });

      this.emitLog("success", `@${this.config.twitterHandle} is up-to-date`);
      this.emit("syncComplete");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emitLog("error", `Sync failed: ${errorMessage}`);
      this.updateStatus({
        status: "error",
        errorMessage,
      });
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Start the bot instance
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Bot instance is already running");
    }

    this.isRunning = true;
    this.emitLog("info", `Starting bot for @${this.config.twitterHandle}`);

    try {
      // Initialize synchronizers
      await this.initializeSynchronizers();

      if (this.synchronizers.length === 0) {
        throw new Error("No platforms configured or all platforms failed to initialize");
      }

      // Perform initial sync
      await this.performSync();

      // Set up sync interval
      this.syncInterval = setInterval(() => {
        if (this.isRunning) {
          this.performSync();
        }
      }, this.config.syncFrequencyMin * 60 * 1000);

      this.emitLog(
        "info",
        `Sync scheduled every ${this.config.syncFrequencyMin} minutes`,
      );
    } catch (error) {
      this.isRunning = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateStatus({
        status: "error",
        errorMessage,
      });
      throw error;
    }
  }

  /**
   * Stop the bot instance
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.updateStatus({
      status: "stopped",
      nextSyncAt: undefined,
    });

    this.emitLog("info", `Stopped bot for @${this.config.twitterHandle}`);
  }

  /**
   * Get current status
   */
  getStatus(): BotInstanceStatus {
    return { ...this.status };
  }

  /**
   * Get bot configuration
   */
  getConfig(): BotConfig {
    return { ...this.config };
  }

  /**
   * Check if bot is running
   */
  get running(): boolean {
    return this.isRunning;
  }
}
