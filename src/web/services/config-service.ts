import { DBType, Schema } from "db";
import { eq, and, desc } from "drizzle-orm";
import { encrypt, decrypt, encryptJSON, decryptJSON } from "./encryption-service";

export interface CreateBotConfigInput {
  twitterHandle: string;
  twitterUsername: string;
  twitterPassword: string;
  enabled?: boolean;
  syncFrequencyMin?: number;
  syncPosts?: boolean;
  syncProfileDescription?: boolean;
  syncProfilePicture?: boolean;
  syncProfileName?: boolean;
  syncProfileHeader?: boolean;
  backdateBlueskyPosts?: boolean;
}

export interface UpdateBotConfigInput {
  twitterHandle?: string;
  twitterUsername?: string;
  twitterPassword?: string;
  enabled?: boolean;
  syncFrequencyMin?: number;
  syncPosts?: boolean;
  syncProfileDescription?: boolean;
  syncProfilePicture?: boolean;
  syncProfileName?: boolean;
  syncProfileHeader?: boolean;
  backdateBlueskyPosts?: boolean;
}

export interface BotConfigOutput {
  id: number;
  twitterHandle: string;
  twitterUsername: string;
  enabled: boolean;
  syncFrequencyMin: number;
  syncPosts: boolean;
  syncProfileDescription: boolean;
  syncProfilePicture: boolean;
  syncProfileName: boolean;
  syncProfileHeader: boolean;
  backdateBlueskyPosts: boolean;
  createdAt: Date;
  updatedAt: Date;
  platforms: PlatformConfigOutput[];
}

export interface CreatePlatformConfigInput {
  botConfigId: number;
  platformId: string;
  enabled?: boolean;
  credentials: Record<string, string>;
}

export interface UpdatePlatformConfigInput {
  enabled?: boolean;
  credentials?: Record<string, string>;
}

export interface PlatformConfigOutput {
  botConfigId: number;
  platformId: string;
  enabled: boolean;
  credentials: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Service for managing bot and platform configurations
 */
export class ConfigService {
  constructor(private db: DBType) {}

  /**
   * Create a new bot configuration
   */
  async createBotConfig(input: CreateBotConfigInput): Promise<BotConfigOutput> {
    // Check if handle already exists
    const existing = await this.db
      .select()
      .from(Schema.BotConfigs)
      .where(eq(Schema.BotConfigs.twitterHandle, input.twitterHandle))
      .get();

    if (existing) {
      throw new Error(`Bot with handle @${input.twitterHandle} already exists`);
    }

    // Encrypt password
    const encryptedPassword = encrypt(input.twitterPassword);

    // Insert bot config
    const result = await this.db
      .insert(Schema.BotConfigs)
      .values({
        twitterHandle: input.twitterHandle,
        twitterUsername: input.twitterUsername,
        twitterPassword: encryptedPassword,
        enabled: input.enabled ?? true,
        syncFrequencyMin: input.syncFrequencyMin ?? 30,
        syncPosts: input.syncPosts ?? true,
        syncProfileDescription: input.syncProfileDescription ?? true,
        syncProfilePicture: input.syncProfilePicture ?? true,
        syncProfileName: input.syncProfileName ?? true,
        syncProfileHeader: input.syncProfileHeader ?? true,
        backdateBlueskyPosts: input.backdateBlueskyPosts ?? true,
      })
      .returning()
      .get();

    // Return the created bot config with its platforms
    const botConfig = await this.getBotConfigById(result.id);
    return botConfig;
  }

  /**
   * Get a bot configuration by ID
   */
  async getBotConfigById(id: number): Promise<BotConfigOutput> {
    const botConfig = await this.db
      .select()
      .from(Schema.BotConfigs)
      .where(eq(Schema.BotConfigs.id, id))
      .get();

    if (!botConfig) {
      throw new Error(`Bot configuration not found: ${id}`);
    }

    const platforms = await this.getPlatformConfigsByBotId(id);

    return {
      id: Number(botConfig.id),
      twitterHandle: botConfig.twitterHandle,
      twitterUsername: botConfig.twitterUsername,
      enabled: botConfig.enabled,
      syncFrequencyMin: Number(botConfig.syncFrequencyMin),
      syncPosts: botConfig.syncPosts,
      syncProfileDescription: botConfig.syncProfileDescription,
      syncProfilePicture: botConfig.syncProfilePicture,
      syncProfileName: botConfig.syncProfileName,
      syncProfileHeader: botConfig.syncProfileHeader,
      backdateBlueskyPosts: botConfig.backdateBlueskyPosts,
      createdAt: new Date(Number(botConfig.createdAt)),
      updatedAt: new Date(Number(botConfig.updatedAt)),
      platforms,
    };
  }

  /**
   * Get all bot configurations
   */
  async getAllBotConfigs(): Promise<BotConfigOutput[]> {
    const botConfigs = await this.db.select().from(Schema.BotConfigs).all();

    return Promise.all(
      botConfigs.map(async (config) => this.getBotConfigById(config.id)),
    );
  }

  /**
   * Update a bot configuration
   */
  async updateBotConfig(
    id: number,
    input: UpdateBotConfigInput,
  ): Promise<BotConfigOutput> {
    const existing = await this.db
      .select()
      .from(Schema.BotConfigs)
      .where(eq(Schema.BotConfigs.id, id))
      .get();

    if (!existing) {
      throw new Error(`Bot configuration not found: ${id}`);
    }

    const updateData: any = {
      ...input,
      updatedAt: new Date(),
    };

    // Encrypt password if provided
    if (input.twitterPassword) {
      updateData.twitterPassword = encrypt(input.twitterPassword);
    }

    await this.db
      .update(Schema.BotConfigs)
      .set(updateData)
      .where(eq(Schema.BotConfigs.id, id));

    return this.getBotConfigById(id);
  }

  /**
   * Delete a bot configuration
   */
  async deleteBotConfig(id: number): Promise<void> {
    await this.db.delete(Schema.BotConfigs).where(eq(Schema.BotConfigs.id, id));
  }

  /**
   * Create a platform configuration
   */
  async createPlatformConfig(
    input: CreatePlatformConfigInput,
  ): Promise<PlatformConfigOutput> {
    // Check if platform already exists for this bot
    const existing = await this.db
      .select()
      .from(Schema.PlatformConfigs)
      .where(
        and(
          eq(Schema.PlatformConfigs.botConfigId, input.botConfigId),
          eq(Schema.PlatformConfigs.platformId, input.platformId),
        ),
      )
      .get();

    if (existing) {
      throw new Error(
        `Platform ${input.platformId} already configured for this bot`,
      );
    }

    // Encrypt credentials
    const encryptedCredentials = encryptJSON(input.credentials);

    await this.db
      .insert(Schema.PlatformConfigs)
      .values({
        botConfigId: input.botConfigId,
        platformId: input.platformId,
        enabled: input.enabled ?? true,
        credentials: encryptedCredentials,
      });

    return this.getPlatformConfig(input.botConfigId, input.platformId);
  }

  /**
   * Get a platform configuration by composite key
   */
  async getPlatformConfig(
    botConfigId: number,
    platformId: string,
  ): Promise<PlatformConfigOutput> {
    const platformConfig = await this.db
      .select()
      .from(Schema.PlatformConfigs)
      .where(
        and(
          eq(Schema.PlatformConfigs.botConfigId, botConfigId),
          eq(Schema.PlatformConfigs.platformId, platformId),
        ),
      )
      .get();

    if (!platformConfig) {
      throw new Error(
        `Platform configuration not found: ${platformId} for bot ${botConfigId}`,
      );
    }

    return {
      botConfigId: Number(platformConfig.botConfigId),
      platformId: platformConfig.platformId,
      enabled: platformConfig.enabled,
      credentials: decryptJSON<Record<string, string>>(platformConfig.credentials),
      createdAt: new Date(Number(platformConfig.createdAt)),
      updatedAt: new Date(Number(platformConfig.updatedAt)),
    };
  }

  /**
   * Get all platform configurations for a bot
   */
  async getPlatformConfigsByBotId(
    botConfigId: number,
  ): Promise<PlatformConfigOutput[]> {
    const platforms = await this.db
      .select()
      .from(Schema.PlatformConfigs)
      .where(eq(Schema.PlatformConfigs.botConfigId, botConfigId))
      .all();

    return platforms.map((p) => ({
      botConfigId: Number(p.botConfigId),
      platformId: p.platformId,
      enabled: p.enabled,
      credentials: decryptJSON<Record<string, string>>(p.credentials),
      createdAt: new Date(Number(p.createdAt)),
      updatedAt: new Date(Number(p.updatedAt)),
    }));
  }

  /**
   * Update a platform configuration
   */
  async updatePlatformConfig(
    botConfigId: number,
    platformId: string,
    input: UpdatePlatformConfigInput,
  ): Promise<PlatformConfigOutput> {
    const existing = await this.db
      .select()
      .from(Schema.PlatformConfigs)
      .where(
        and(
          eq(Schema.PlatformConfigs.botConfigId, botConfigId),
          eq(Schema.PlatformConfigs.platformId, platformId),
        ),
      )
      .get();

    if (!existing) {
      throw new Error(
        `Platform configuration not found: ${platformId} for bot ${botConfigId}`,
      );
    }

    const updateData: any = {
      enabled: input.enabled,
      updatedAt: new Date(),
    };

    // Encrypt credentials if provided
    if (input.credentials) {
      updateData.credentials = encryptJSON(input.credentials);
    }

    await this.db
      .update(Schema.PlatformConfigs)
      .set(updateData)
      .where(
        and(
          eq(Schema.PlatformConfigs.botConfigId, botConfigId),
          eq(Schema.PlatformConfigs.platformId, platformId),
        ),
      );

    return this.getPlatformConfig(botConfigId, platformId);
  }

  /**
   * Delete a platform configuration
   */
  async deletePlatformConfig(
    botConfigId: number,
    platformId: string,
  ): Promise<void> {
    await this.db
      .delete(Schema.PlatformConfigs)
      .where(
        and(
          eq(Schema.PlatformConfigs.botConfigId, botConfigId),
          eq(Schema.PlatformConfigs.platformId, platformId),
        ),
      );
  }

  /**
   * Get sync logs for a bot
   */
  async getSyncLogs(
    botConfigId: number,
    limit: number = 100,
    offset: number = 0,
  ): Promise<any[]> {
    const logs = await this.db
      .select()
      .from(Schema.SyncLogs)
      .where(eq(Schema.SyncLogs.botConfigId, botConfigId))
      .orderBy(desc(Schema.SyncLogs.timestamp))
      .limit(limit)
      .offset(offset)
      .all();

    return logs.map((l) => ({
      ...l,
      id: Number(l.id),
      botConfigId: Number(l.botConfigId),
      timestamp: new Date(Number(l.timestamp)),
    }));
  }
}
