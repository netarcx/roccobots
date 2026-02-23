import { Scraper, Tweet } from "@the-convocation/twitter-scraper";
import { type DBType, Schema } from "db";
import { eq, or } from "drizzle-orm";
import {
  DEBUG,
  FORCE_SYNC_POSTS,
  MAX_CONSECUTIVE_CACHED as MAX_NEW_CONSECUTIVE_CACHED,
  type TwitterHandle,
} from "env";
import ora from "ora";
import { toMetaPost } from "types/meta-tweet";
import { isValidPost } from "types/post";
import { logError, oraPrefixer } from "utils/logs";
import { withRetry } from "utils/retry";
import { extractWordsAndSpacers } from "utils/tweet/split-tweet-text/extract-words-and-spacers";
import { buildChunksFromSplitterEntries } from "utils/tweet/split-tweet-text/split-tweet-text";

import { getPostStore } from "../utils/get-post-store";
import type { TaggedSynchronizer } from "./synchronizer";
import { applyTransformRules } from "./transforms/apply-transforms";
import { TransformRulesConfig } from "./transforms/transform-types";

const MAX_TWEET = 200;

const TweetMap = Schema.TweetMap;
const TweetSynced = Schema.TweetSynced;

export type SyncLogCallback = (
  level: "info" | "warn" | "error" | "success",
  message: string,
  platform?: string,
  tweetId?: string,
) => void;

export async function syncPosts(args: {
  db: DBType;
  handle: TwitterHandle;
  x: Scraper;
  synchronizers: TaggedSynchronizer[];
  onLog?: SyncLogCallback;
  transformRules?: TransformRulesConfig | null;
}) {
  const { db, handle, x, synchronizers, onLog, transformRules } = args;
  if (!synchronizers.filter((s) => s.syncPost).length) {
    return;
  }
  const log = ora({
    color: "cyan",
    prefixText: oraPrefixer("posts"),
  }).start();
  log.text = "starting...";
  onLog?.("info", "Fetching tweets...");

  let cachedCounter = 0;
  let counter = 0;
  try {
    if (DEBUG) console.log("getting", handle);
    const iter = x.getTweets(handle.handle, MAX_TWEET);
    log.text = "Created async iterator";
    for await (const tweet of iter) {
      counter++;
      log.text = `syncing [${counter}/${MAX_TWEET}]`;
      if (cachedCounter >= MAX_NEW_CONSECUTIVE_CACHED) {
        log.info("skipping because too many consecutive cached tweets");
        onLog?.(
          "info",
          `Stopping early — ${MAX_NEW_CONSECUTIVE_CACHED} consecutive cached tweets`,
        );
        break;
      }
      if (!isValidPost(tweet)) {
        log.warn(`tweet is not valid...\n${tweet}`);
        continue;
      }
      const synced = db
        .select()
        .from(TweetSynced)
        .where(eq(TweetSynced.tweetId, tweet.id))
        .get();
      if (synced && synced.synced !== 0 && !FORCE_SYNC_POSTS) {
        log.info("skipping synced tweet");
        cachedCounter++;
        log.info(
          `encounter cached tweet [${cachedCounter}/${MAX_NEW_CONSECUTIVE_CACHED}]`,
        );
        continue;
      } else {
        cachedCounter = 0;
      }

      const metaTweet = toMetaPost(tweet);
      try {
        for (const s of args.synchronizers) {
          // Might have race condition if done in parallel
          if (!s.syncPost) continue;
          const platformLog = ora({
            color: "cyan",
            prefixText: oraPrefixer(`${s.emoji} ${s.displayName}`),
          });
          try {
            // Apply per-platform text transforms
            let tweetForPlatform = metaTweet;
            if (transformRules) {
              const transformed = applyTransformRules(
                metaTweet.text,
                transformRules,
                s.platformId,
              );
              if (transformed !== metaTweet.text) {
                tweetForPlatform = {
                  ...metaTweet,
                  text: transformed,
                  chunk: async (chunkArgs) => {
                    const entries = extractWordsAndSpacers(
                      transformed,
                      tweet.urls ?? [],
                    );
                    return buildChunksFromSplitterEntries({
                      entries,
                      quotedStatusId: tweet.quotedStatusId,
                      maxChunkSize: chunkArgs.maxChunkSize,
                      quotedStatusLinkSection:
                        chunkArgs.quotedStatusLinkSection ?? "",
                      appendQuoteLink: chunkArgs.appendQuoteLink,
                    });
                  },
                };
              }
            }

            platformLog.text = `| syncing ${s.emoji} ${s.displayName}...`;
            const store = await getPostStore({
              db,
              tweet,
              platformId: s.platformId,
              s: s.storeSchema,
            });
            const syncRes = await withRetry(
              () =>
                s.syncPost!({
                  log: platformLog,
                  tweet: tweetForPlatform,
                  store,
                }),
              {
                maxRetries: 3,
                onRetry: (attempt, error) => {
                  onLog?.(
                    "warn",
                    `Retry ${attempt}/3 for ${s.displayName}: ${error}`,
                    s.platformId,
                    tweet.id,
                  );
                },
              },
            );
            const storeStr = syncRes ? JSON.stringify(syncRes.store) : "";
            await db
              .insert(TweetMap)
              .values({
                tweetId: tweet.id,
                platform: s.platformId,
                platformStore: storeStr,
              })
              .onConflictDoNothing();
            platformLog.succeed(`${s.emoji} ${s.displayName} synced`);
            onLog?.(
              "success",
              `Synced tweet to ${s.displayName}`,
              s.platformId,
              tweet.id,
            );
          } catch (e) {
            logError(
              platformLog,
              e,
            )`Failed to sync tweet ${tweet.id} to ${s.displayName}: ${e}`;
            console.warn(e);
            onLog?.(
              "error",
              `Failed to sync tweet ${tweet.id} to ${s.displayName}: ${e}`,
              s.platformId,
              tweet.id,
            );
          }
          platformLog.stop();
        }
        // Mark as synced
        await db
          .insert(TweetSynced)
          .values({ tweetId: tweet.id, synced: 1 })
          .onConflictDoUpdate({
            target: TweetSynced.tweetId,
            set: { synced: 1 },
          })
          .run();
      } catch (e) {
        logError(log, e)`Failed to sync tweet: ${e}`;
        console.error(e);
        console.error(tweet);
      }
    }
  } catch (e) {
    console.error("Scraper failed with an error:", e);
    onLog?.("error", `Scraper error: ${e}`);
  }

  log.succeed("synced");
  onLog?.("success", `Post sync complete (${counter} tweets checked)`);
}
