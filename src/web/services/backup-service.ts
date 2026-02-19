import { DBType, Schema } from "db";
import { z } from "zod";

import { ConfigService } from "./config-service";

const PlatformBackupSchema = z.object({
  platformId: z.string(),
  enabled: z.boolean(),
  credentials: z.record(z.string()),
});

const BotBackupSchema = z.object({
  twitterHandle: z.string(),
  enabled: z.boolean(),
  syncFrequencyMin: z.number(),
  syncPosts: z.boolean(),
  syncProfileDescription: z.boolean(),
  syncProfilePicture: z.boolean(),
  syncProfileName: z.boolean(),
  syncProfileHeader: z.boolean(),
  backdateBlueskyPosts: z.boolean(),
  platforms: z.array(PlatformBackupSchema),
});

const SyncStateEntrySchema = z.object({
  tweetId: z.string(),
  platform: z.string(),
  platformPostId: z.string(),
});

const BackupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  twitterAuth: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .nullable(),
  bots: z.array(BotBackupSchema),
  syncState: z.array(SyncStateEntrySchema),
});

export type BackupData = z.infer<typeof BackupSchema>;

export interface ImportResult {
  botsCreated: number;
  botsSkipped: string[];
  platformsCreated: number;
  twitterAuthRestored: boolean;
  syncStateRestored: number;
  errors: string[];
}

/**
 * Export all bot configurations, credentials, and sync state as a JSON backup.
 * Credentials are decrypted so the backup is portable across encryption keys.
 */
export async function exportBackup(
  configService: ConfigService,
  db: DBType,
): Promise<BackupData> {
  const allBots = await configService.getAllBotConfigs();
  const twitterAuth = await configService.getTwitterAuthDecrypted();
  const tweetMapRows = await db.select().from(Schema.TweetMap).all();

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    twitterAuth: twitterAuth
      ? { username: twitterAuth.username, password: twitterAuth.password }
      : null,
    bots: allBots.map((bot) => ({
      twitterHandle: bot.twitterHandle,
      enabled: bot.enabled,
      syncFrequencyMin: bot.syncFrequencyMin,
      syncPosts: bot.syncPosts,
      syncProfileDescription: bot.syncProfileDescription,
      syncProfilePicture: bot.syncProfilePicture,
      syncProfileName: bot.syncProfileName,
      syncProfileHeader: bot.syncProfileHeader,
      backdateBlueskyPosts: bot.backdateBlueskyPosts,
      platforms: bot.platforms.map((p) => ({
        platformId: p.platformId,
        enabled: p.enabled,
        credentials: p.credentials,
      })),
    })),
    syncState: tweetMapRows.map((row) => ({
      tweetId: row.tweetId,
      platform: row.platform,
      platformPostId: row.platformStore,
    })),
  };
}

/**
 * Import bot configurations, credentials, and sync state from a JSON backup.
 * Skips bots whose twitter handle already exists. Credentials are re-encrypted
 * with the current server's encryption key.
 */
export async function importBackup(
  configService: ConfigService,
  db: DBType,
  rawData: unknown,
): Promise<ImportResult> {
  const data = BackupSchema.parse(rawData);

  const result: ImportResult = {
    botsCreated: 0,
    botsSkipped: [],
    platformsCreated: 0,
    twitterAuthRestored: false,
    syncStateRestored: 0,
    errors: [],
  };

  // Restore Twitter auth
  if (data.twitterAuth) {
    try {
      await configService.setTwitterAuth(
        data.twitterAuth.username,
        data.twitterAuth.password,
      );
      result.twitterAuthRestored = true;
    } catch (error) {
      result.errors.push(
        `Failed to restore Twitter auth: ${(error as Error).message}`,
      );
    }
  }

  // Get existing bots to check for duplicates
  const existingBots = await configService.getAllBotConfigs();
  const existingHandles = new Set(
    existingBots.map((b) => b.twitterHandle.toLowerCase()),
  );

  // Restore bots
  for (const bot of data.bots) {
    if (existingHandles.has(bot.twitterHandle.toLowerCase())) {
      result.botsSkipped.push(bot.twitterHandle);
      continue;
    }

    try {
      const created = await configService.createBotConfig({
        twitterHandle: bot.twitterHandle,
        enabled: bot.enabled,
        syncFrequencyMin: bot.syncFrequencyMin,
        syncPosts: bot.syncPosts,
        syncProfileDescription: bot.syncProfileDescription,
        syncProfilePicture: bot.syncProfilePicture,
        syncProfileName: bot.syncProfileName,
        syncProfileHeader: bot.syncProfileHeader,
        backdateBlueskyPosts: bot.backdateBlueskyPosts,
      });
      result.botsCreated++;

      // Restore platform configs
      for (const platform of bot.platforms) {
        try {
          await configService.createPlatformConfig({
            botConfigId: created.id,
            platformId: platform.platformId,
            enabled: platform.enabled,
            credentials: platform.credentials,
          });
          result.platformsCreated++;
        } catch (error) {
          result.errors.push(
            `Failed to restore ${platform.platformId} for @${bot.twitterHandle}: ${(error as Error).message}`,
          );
        }
      }
    } catch (error) {
      result.errors.push(
        `Failed to restore bot @${bot.twitterHandle}: ${(error as Error).message}`,
      );
    }
  }

  // Restore sync state (tweet_map) — skip duplicates via INSERT OR IGNORE
  for (const entry of data.syncState) {
    try {
      await db
        .insert(Schema.TweetMap)
        .values({
          tweetId: entry.tweetId,
          platform: entry.platform,
          platformStore: entry.platformPostId,
        })
        .onConflictDoNothing();
      result.syncStateRestored++;
    } catch (_error) {
      // Silently skip duplicates
    }
  }

  return result;
}
