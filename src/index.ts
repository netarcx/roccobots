// Check if running in web mode
import { db } from "db";
import ora from "ora";
import { BlueskySynchronizerFactory } from "sync/platforms/bluesky";
import { DiscordWebhookSynchronizerFactory } from "sync/platforms/discord-webhook/webhook-sync";
import { MisskeySynchronizerFactory } from "sync/platforms/misskey/missky-sync";
import { syncPosts } from "sync/sync-posts";
import { syncProfile } from "sync/sync-profile";
import { TaggedSynchronizer } from "sync/synchronizer";
import { createTwitterClient, cycleTLSExit } from "sync/x-client";
import { logError, oraPrefixer } from "utils/logs";
import { sendNotification } from "utils/notifications";

import {
  DAEMON,
  SYNC_FREQUENCY_MIN,
  SYNC_POSTS,
  TOUITOMAMOUT_VERSION,
  TWITTER_HANDLES,
  TWITTER_PASSWORD,
  TWITTER_USERNAME,
  TwitterHandle,
} from "./env";

if (process.env.WEB_MODE === "true") {
  console.log(
    "⚠️  WEB_MODE is enabled. Please use 'bun src/web-index.ts' instead.",
  );
  console.log("   Or unset WEB_MODE to run in CLI mode.");
  process.exit(1);
}

let interval: NodeJS.Timeout | null = null;
process.on("exit", (code) => {
  console.log(`Process exited with code ${code}`);
});
// Register event
process.on("SIGINT", () => {
  console.log("\nReceived SIGINT (Ctrl+C). Exiting...");
  if (interval) clearInterval(interval); // stop daemon loop
  try {
    cycleTLSExit();
  } catch {}
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Received SIGTERM. Exiting...");
  if (interval) clearInterval(interval);
  try {
    cycleTLSExit();
  } catch {}
  process.exit(0);
});

console.log(`\n
  RoccoBots@v${TOUITOMAMOUT_VERSION}
    \\
░░░░░▓██▓█░░▒▒▒▒▓▓▒▒░░░▒▒▓███▒░░░░░░░░
░░░░░░▓█▓▓▒░ ░▓▓░   ░░░▒▓▓▓█▓▒░░░░░░░░
░░░░░░░▒▓▓▓▓▒▒▓█▓▓▒▒▒▒▓▓▓▓▓▓▒░░░░░░░░░
░░░░░░▒░░▓▓▓▓██████████▓▓▓▒▒░░░░░░░░░░
░░░░░░░░▒░░▒▓█████▓▓██▓▒▒▒▒░░░░░░░░░░░
░░░░░░░░░░▒▒▓▓▓▓▓▒▒▒▒▒▒▒▒░░░░░░░░░░░░░
░░░░░░░░░░░░░▓▓▓▒▒▓▓▓▒░░░░░░░░░░░░░░░░
░░░░░░░░░░░░░░▓██▓▓▒▓▒░░░░░░░░░░░░░░░░
░░░░░░░░░░░░░░▓▓████▓░░░░░░▒░░░░▒▒▒▒▓▒
░░░█▒░░░░░░▒▒▒▒▓▓▓▓▓▓▒▒▒▒▒▒▓▓▓▓▓▓█████
░▒▒█░░▒▓▓▓▓▓▓▓▓▓█████▒▓█▓█▓▓▒▒▓██▓▓▓▒░
░▒▒▓▒▓█████▓▓███▓▓▓▓▓▒▓▓▓▓███▓▓██▒▒░░░
░▒▒█▓████████████▒▒▒▒▒░▓▓▓███████▒▒░░░
░▒▒▓█████████████▓▒▒▒▒▒▒▓▓███████▒▒░░░
░▒▒██████████████▓▒▓▒░▒▒▒▓██████▓▒▒▒▒▓
▒▒▓██████████████▓▒▓▓▒░█▓▒▓███████▓▓██
▒▓▓████████████████▓▒▒▒▒▓▒▓█████████▓▒
▒▓████████████████████░▒▓██████████▓▓▓
▒▓███████████████████████████████████▓
▓▓█▓▓████████████████████████████▓▓██▓
  `);

const factories = [
  BlueskySynchronizerFactory,
  MisskeySynchronizerFactory,
  DiscordWebhookSynchronizerFactory,
] as const;

let xClient;
try {
  xClient = await createTwitterClient({
    twitterPassword: TWITTER_PASSWORD,
    twitterUsername: TWITTER_USERNAME,
    db,
  });
} catch (error) {
  sendNotification(
    "Twitter client failed",
    error instanceof Error ? error.message : String(error),
    "failure",
    "twitter-client",
  );
  throw error;
}

const users: SyncUser[] = [];
interface SyncUser {
  handle: TwitterHandle;
  synchronizers: TaggedSynchronizer[];
}

for (const handle of TWITTER_HANDLES) {
  console.log(`Connecting @${handle.handle}...`);
  const synchronizers: TaggedSynchronizer[] = [];
  for (const factory of factories) {
    const log = ora({
      color: "gray",
      prefixText: oraPrefixer(`${factory.EMOJI} client`),
    }).start(`Connecting to ${factory.DISPLAY_NAME}`);

    const envKeys = factory.ENV_KEYS;
    type K = (typeof factory.ENV_KEYS)[number];
    const fallback = factory.FALLBACK_ENV ?? {};
    type EnvType = Record<K, string>;
    const env: typeof factory.FALLBACK_ENV = {};
    let skip = false;
    for (const key of envKeys) {
      const osKey = key + handle.postFix;
      const val =
        process.env[osKey] ||
        (fallback[key as keyof typeof fallback] as string | undefined);
      if (!val) {
        log.warn(
          `${factory.DISPLAY_NAME} will not be synced because "${osKey}" is not set`,
        );
        // console.warn(`Because ${osKey} is not set.`);
        skip = true;
        break;
      }
      //@ts-expect-error
      env[key as string] = val;
    }
    if (skip) {
      continue;
    }

    try {
      const s = await factory.create({
        xClient: xClient,
        env: env as EnvType,
        db: db,
        slot: handle.slot,
        log,
      });
      synchronizers.push({
        ...s,
        displayName: factory.DISPLAY_NAME,
        emoji: factory.EMOJI,
        platformId: factory.PLATFORM_ID,
        storeSchema: factory.STORE_SCHEMA,
      });
      log.succeed("connected");
    } catch (error) {
      logError(
        log,
        error,
      )`Failed to connect to ${factory.DISPLAY_NAME}: ${error}`;
    } finally {
      log.stop();
    }
  }

  users.push({
    handle,
    synchronizers,
  });
}

/**
 * Main syncing loop
 */
const syncAll = async () => {
  if (!users) {
    throw Error("Unable to sync anything...");
  }

  for await (const user of users) {
    console.log(
      `\n𝕏 ->  ${user.synchronizers.map((s) => s.emoji).join(" + ")}`,
    );
    console.log(`| @${user.handle.handle}`);
    try {
      await syncProfile({
        x: xClient,
        twitterHandle: user.handle,
        synchronizers: user.synchronizers,
        db,
      });
      if (!SYNC_POSTS) {
        console.log("Posts will not be synced...");
        continue;
      }
      await syncPosts({
        db,
        handle: user.handle,
        x: xClient,
        synchronizers: user.synchronizers,
      });
      console.log(`| ${user.handle.handle} is up-to-date 🔄`);
    } catch (error) {
      console.error(`Sync failed for @${user.handle.handle}:`, error);
      sendNotification(
        `Sync failed for @${user.handle.handle}`,
        error instanceof Error ? error.message : String(error),
        "failure",
        `sync-${user.handle.handle}`,
      );
    }
  }
};

await syncAll();

if (DAEMON) {
  console.log(`Run daemon every ${SYNC_FREQUENCY_MIN}min`);
  interval = setInterval(
    async () => {
      await syncAll();
    },
    SYNC_FREQUENCY_MIN * 60 * 1000,
  );
}
