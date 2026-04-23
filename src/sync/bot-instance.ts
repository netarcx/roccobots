import { Scraper as XClient } from "@the-convocation/twitter-scraper";
import { DBType, Schema } from "db";
import { eq } from "drizzle-orm";
import { EventEmitter } from "events";
import ora, { Ora } from "ora";
import { BlueskySynchronizerFactory } from "sync/platforms/bluesky";
import { DiscordWebhookSynchronizerFactory } from "sync/platforms/discord-webhook/webhook-sync";
import { MastodonSynchronizerFactory } from "sync/platforms/mastodon/mastodon-sync";
import { MisskeySynchronizerFactory } from "sync/platforms/misskey/missky-sync";
import { syncPosts } from "sync/sync-posts";
import { syncProfile } from "sync/sync-profile";
import { SynchronizerFactory, TaggedSynchronizer } from "sync/synchronizer";
import { MentionMap } from "sync/transforms/apply-mention-overrides";
import { TransformRulesConfig } from "sync/transforms/transform-types";

export interface BotConfig {
  id: number;
  twitterHandle: string;
  syncFrequencyMin: number;
  adaptivePolling: boolean;
  syncPosts: boolean;
  syncProfileDescription: boolean;
  syncProfilePicture: boolean;
  syncProfileName: boolean;
  syncProfileHeader: boolean;
  backdateBlueskyPosts: boolean;
  transformRules: TransformRulesConfig | null;
  platforms: {
    platformId: string;
    enabled: boolean;
    credentials: Record<string, string>;
  }[];
}

const HARD_FLOOR_MIN = 2;
const HARD_CEILING_MIN = 240;

function computeAdaptiveBounds(baselineMin: number) {
  return {
    minMin: Math.max(Math.round(baselineMin * 0.25), HARD_FLOOR_MIN),
    maxMin: Math.min(Math.round(baselineMin * 4), HARD_CEILING_MIN),
  };
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
  private syncTimeout: NodeJS.Timeout | null = null;
  private currentIntervalMin: number;
  private status: BotInstanceStatus = {
    status: "stopped",
  };
  private isRunning = false;
  private isMuted = false;

  constructor(config: BotConfig, db: DBType, xClient: XClient) {
    super();
    this.config = config;
    this.db = db;
    this.xClient = xClient;
    this.currentIntervalMin = config.syncFrequencyMin;
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

      const factory = factories.find(
        (f) => f.PLATFORM_ID === platform.platformId,
      );
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
        this.emitLog(
          "success",
          `Connected to ${factory.DISPLAY_NAME}`,
          platform.platformId,
        );
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
   * Load the global mention override map from the DB into a plain object.
   */
  private async loadGlobalMentionOverrides(): Promise<MentionMap> {
    const rows = await this.db.select().from(Schema.MentionOverrides).all();
    const map: MentionMap = {};
    for (const r of rows) {
      map[r.twitterHandle.toLowerCase()] = r.blueskyHandle;
    }
    return map;
  }

  /**
   * Load this bot's per-bot mention override map fresh from the DB. Runs
   * each sync cycle so dashboard edits take effect without a bot restart.
   */
  private async loadPerBotMentionOverrides(): Promise<MentionMap | null> {
    const row = await this.db
      .select({ mentionOverrides: Schema.BotConfigs.mentionOverrides })
      .from(Schema.BotConfigs)
      .where(eq(Schema.BotConfigs.id, this.config.id))
      .get();
    if (!row?.mentionOverrides) return null;
    try {
      const parsed = JSON.parse(row.mentionOverrides);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      const out: MentionMap = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v.length > 0) {
          out[k.toLowerCase()] = v;
        }
      }
      return Object.keys(out).length > 0 ? out : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Compute the next polling interval in minutes. When adaptive polling is off,
   * always returns the baseline. When on, accelerates on new activity and
   * decelerates on idle cycles, clamped to 0.25x–4x of the baseline.
   */
  private computeNextIntervalMin(newPostCount: number): number {
    const baseline = this.config.syncFrequencyMin;
    if (!this.config.adaptivePolling) {
      this.currentIntervalMin = baseline;
      return baseline;
    }
    const { minMin, maxMin } = computeAdaptiveBounds(baseline);
    const factor = newPostCount > 0 ? 0.5 : 1.5;
    const next = Math.max(
      minMin,
      Math.min(maxMin, Math.round(this.currentIntervalMin * factor)),
    );
    this.currentIntervalMin = next;
    return next;
  }

  /**
   * Schedule the next sync via setTimeout. Safe to call repeatedly — always
   * clears any pending timeout first.
   */
  private scheduleNextSync(delayMin: number): void {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
    if (!this.isRunning) return;
    this.syncTimeout = setTimeout(
      () => {
        if (this.isRunning) {
          this.performSync();
        }
      },
      delayMin * 60 * 1000,
    );
  }

  /**
   * Perform a sync cycle. Self-schedules the next run at the end (even on
   * failure) so the loop continues.
   */
  private async performSync(): Promise<void> {
    if (this.isMuted) {
      this.emitLog("info", "Sync skipped (bot is muted)");
      this.scheduleNextSync(this.config.syncFrequencyMin);
      return;
    }

    let newPostCount = 0;
    let syncFailed = false;

    try {
      this.emitLog("info", `Starting sync for @${this.config.twitterHandle}`);

      const onLog = this.emitLog.bind(this);

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
        onLog,
        syncOptions: {
          syncProfileDescription: this.config.syncProfileDescription,
          syncProfilePicture: this.config.syncProfilePicture,
          syncProfileName: this.config.syncProfileName,
          syncProfileHeader: this.config.syncProfileHeader,
        },
      });

      // Sync posts if enabled
      if (this.config.syncPosts) {
        // Load mention maps fresh each cycle — tables are tiny and this
        // avoids stale state when the maps are edited from the dashboard.
        const [globalMentionOverrides, perBotMentionOverrides] =
          await Promise.all([
            this.loadGlobalMentionOverrides(),
            this.loadPerBotMentionOverrides(),
          ]);
        const result = await syncPosts({
          db: this.db,
          handle: {
            handle: this.config.twitterHandle,
            postFix: this.config.id,
            slot: this.config.id,
            env: `TWITTER_HANDLE${this.config.id}` as any,
          },
          x: this.xClient,
          synchronizers: this.synchronizers,
          onLog,
          transformRules: this.config.transformRules,
          perBotMentionOverrides,
          globalMentionOverrides,
        });
        newPostCount = result?.newPostCount ?? 0;
      } else {
        this.emitLog("info", "Post syncing is disabled");
      }

      this.emitLog("success", `@${this.config.twitterHandle} is up-to-date`);
      this.emit("syncComplete");
    } catch (error) {
      syncFailed = true;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emitLog("error", `Sync failed: ${errorMessage}`);
      this.updateStatus({
        status: "error",
        errorMessage,
      });
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // Schedule the next run regardless of success/failure. On failure, fall
    // back to the baseline interval rather than adapting off partial data.
    const nextIntervalMin = syncFailed
      ? this.config.syncFrequencyMin
      : this.computeNextIntervalMin(newPostCount);
    const now = new Date();
    const nextSync = new Date(now.getTime() + nextIntervalMin * 60 * 1000);

    if (!syncFailed) {
      this.updateStatus({
        status: "running",
        lastSyncAt: now,
        nextSyncAt: nextSync,
        errorMessage: undefined,
      });
    } else {
      this.updateStatus({ nextSyncAt: nextSync });
    }

    this.scheduleNextSync(nextIntervalMin);
  }

  /**
   * Trigger an immediate sync cycle (used by command handler). Cancels any
   * pending scheduled sync so we don't end up with two concurrent timers —
   * performSync will self-schedule the next run.
   */
  async triggerSync(): Promise<void> {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
    await this.performSync();
  }

  /**
   * Update the sync frequency baseline on a running bot and reschedule.
   * Called by BotManager when the user changes frequency via dashboard or
   * the !frequency Bluesky command.
   */
  updateFrequency(newBaselineMin: number): void {
    this.config.syncFrequencyMin = newBaselineMin;
    this.currentIntervalMin = newBaselineMin;
    this.emitLog(
      "info",
      `Sync frequency updated to ${newBaselineMin} min (rescheduling)`,
    );
    if (this.isRunning) {
      this.scheduleNextSync(newBaselineMin);
      const nextSync = new Date(Date.now() + newBaselineMin * 60 * 1000);
      this.updateStatus({ nextSyncAt: nextSync });
    }
  }

  /**
   * Mute the bot (pause syncing, keep polling)
   */
  mute(): void {
    this.isMuted = true;
    this.emitLog("info", "Bot muted — syncing paused");
  }

  /**
   * Unmute the bot (resume syncing)
   */
  unmute(): void {
    this.isMuted = false;
    this.emitLog("info", "Bot unmuted — syncing resumed");
  }

  /**
   * Check if bot is muted
   */
  get muted(): boolean {
    return this.isMuted;
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
        throw new Error(
          "No platforms configured or all platforms failed to initialize",
        );
      }

      // Perform initial sync — performSync self-schedules the next run.
      await this.performSync();

      const modeLabel = this.config.adaptivePolling
        ? `adaptive (baseline ${this.config.syncFrequencyMin} min, 0.25x–4x)`
        : `every ${this.config.syncFrequencyMin} minutes`;
      this.emitLog("info", `Sync scheduled ${modeLabel}`);
    } catch (error) {
      this.isRunning = false;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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

    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
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
