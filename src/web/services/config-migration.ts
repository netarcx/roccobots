import { ConfigService } from "./config-service";
import { readFileSync } from "fs";
import { join } from "path";

export interface EnvConfig {
  TWITTER_HANDLE: string;
  TWITTER_USERNAME: string;
  TWITTER_PASSWORD: string;
  SYNC_FREQUENCY_MIN?: string;
  SYNC_POSTS?: string;
  SYNC_PROFILE_DESCRIPTION?: string;
  SYNC_PROFILE_PICTURE?: string;
  SYNC_PROFILE_NAME?: string;
  SYNC_PROFILE_HEADER?: string;
  BACKDATE_BLUESKY_POSTS?: string;
  // Bluesky
  BLUESKY_IDENTIFIER?: string;
  BLUESKY_PASSWORD?: string;
  // Mastodon
  MASTODON_INSTANCE?: string;
  MASTODON_TOKEN?: string;
  // Misskey
  MISSKEY_INSTANCE?: string;
  MISSKEY_TOKEN?: string;
  // Discord
  DISCORD_WEBHOOK?: string;
}

/**
 * Parse .env file content
 */
function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Parse KEY=VALUE
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      env[key] = value;
    }
  }

  return env;
}

/**
 * Import configuration from .env file
 */
export async function importFromEnv(
  configService: ConfigService,
  envPath?: string,
): Promise<{ created: number; errors: string[] }> {
  const errors: string[] = [];
  let created = 0;

  try {
    // Read .env file
    const path = envPath || join(process.cwd(), ".env");
    const content = readFileSync(path, "utf-8");
    const env = parseEnvFile(content);

    // Check for multiple handles
    const handles: string[] = [];
    let handleIndex = 0;

    while (true) {
      const key = handleIndex === 0 ? "TWITTER_HANDLE" : `TWITTER_HANDLE${handleIndex}`;
      if (env[key]) {
        handles.push(env[key]);
        handleIndex++;
      } else {
        break;
      }
    }

    if (handles.length === 0) {
      errors.push("No TWITTER_HANDLE found in .env file");
      return { created, errors };
    }

    // Import each handle
    for (let i = 0; i < handles.length; i++) {
      const postfix = i === 0 ? "" : i.toString();
      const handle = handles[i];

      try {
        // Get Twitter credentials
        const username = env[`TWITTER_USERNAME${postfix}`] || env.TWITTER_USERNAME;
        const password = env[`TWITTER_PASSWORD${postfix}`] || env.TWITTER_PASSWORD;

        if (!username || !password) {
          errors.push(`Missing Twitter credentials for handle ${handle}`);
          continue;
        }

        // Create bot config
        const botConfig = await configService.createBotConfig({
          twitterHandle: handle.replace("@", ""),
          twitterUsername: username,
          twitterPassword: password,
          syncFrequencyMin: env.SYNC_FREQUENCY_MIN
            ? parseInt(env.SYNC_FREQUENCY_MIN)
            : 30,
          syncPosts: env.SYNC_POSTS !== "false",
          syncProfileDescription: env.SYNC_PROFILE_DESCRIPTION !== "false",
          syncProfilePicture: env.SYNC_PROFILE_PICTURE !== "false",
          syncProfileName: env.SYNC_PROFILE_NAME !== "false",
          syncProfileHeader: env.SYNC_PROFILE_HEADER !== "false",
          backdateBlueskyPosts: env.BACKDATE_BLUESKY_POSTS !== "false",
        });

        created++;

        // Add Bluesky platform if configured
        const blueskyId =
          env[`BLUESKY_IDENTIFIER${postfix}`] || env.BLUESKY_IDENTIFIER;
        const blueskyPw = env[`BLUESKY_PASSWORD${postfix}`] || env.BLUESKY_PASSWORD;

        if (blueskyId && blueskyPw) {
          try {
            await configService.createPlatformConfig({
              botConfigId: botConfig.id,
              platformId: "bluesky",
              credentials: {
                BLUESKY_IDENTIFIER: blueskyId,
                BLUESKY_PASSWORD: blueskyPw,
              },
            });
          } catch (error) {
            errors.push(
              `Failed to add Bluesky platform for ${handle}: ${(error as Error).message}`,
            );
          }
        }

        // Add Mastodon platform if configured
        const mastodonInstance =
          env[`MASTODON_INSTANCE${postfix}`] || env.MASTODON_INSTANCE;
        const mastodonToken =
          env[`MASTODON_TOKEN${postfix}`] || env.MASTODON_TOKEN;

        if (mastodonInstance && mastodonToken) {
          try {
            await configService.createPlatformConfig({
              botConfigId: botConfig.id,
              platformId: "mastodon",
              credentials: {
                MASTODON_INSTANCE: mastodonInstance,
                MASTODON_ACCESS_TOKEN: mastodonToken,
              },
            });
          } catch (error) {
            errors.push(
              `Failed to add Mastodon platform for ${handle}: ${(error as Error).message}`,
            );
          }
        }

        // Add Misskey platform if configured
        const misskeyInstance =
          env[`MISSKEY_INSTANCE${postfix}`] || env.MISSKEY_INSTANCE;
        const misskeyToken = env[`MISSKEY_TOKEN${postfix}`] || env.MISSKEY_TOKEN;

        if (misskeyInstance && misskeyToken) {
          try {
            await configService.createPlatformConfig({
              botConfigId: botConfig.id,
              platformId: "misskey",
              credentials: {
                MISSKEY_INSTANCE: misskeyInstance,
                MISSKEY_ACCESS_CODE: misskeyToken,
              },
            });
          } catch (error) {
            errors.push(
              `Failed to add Misskey platform for ${handle}: ${(error as Error).message}`,
            );
          }
        }

        // Add Discord platform if configured
        const discordWebhook =
          env[`DISCORD_WEBHOOK${postfix}`] || env.DISCORD_WEBHOOK;

        if (discordWebhook) {
          try {
            await configService.createPlatformConfig({
              botConfigId: botConfig.id,
              platformId: "discord",
              credentials: {
                DISCORD_WEBHOOK_URL: discordWebhook,
              },
            });
          } catch (error) {
            errors.push(
              `Failed to add Discord platform for ${handle}: ${(error as Error).message}`,
            );
          }
        }
      } catch (error) {
        errors.push(`Failed to import ${handle}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    errors.push(`Failed to read .env file: ${(error as Error).message}`);
  }

  return { created, errors };
}
