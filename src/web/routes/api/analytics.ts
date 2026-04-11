import AtpAgent, { CredentialSession } from "@atproto/api";
import { Schema } from "db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";

import { requireAuth } from "../../middleware/auth";
import { BotManager } from "../../services/bot-manager";
import { ConfigService } from "../../services/config-service";

const analyticsRouter = new Hono<{
  Variables: {
    configService: ConfigService;
    botManager: BotManager;
  };
}>();

analyticsRouter.use("*", requireAuth);

function rangeToDate(range: string | undefined): Date | null {
  const now = Date.now();
  if (range === "day") return new Date(now - 86400 * 1000);
  if (range === "week") return new Date(now - 7 * 86400 * 1000);
  if (range === "month") return new Date(now - 30 * 86400 * 1000);
  return null;
}

/**
 * GET /api/analytics/combined?range=day|week|month|all
 * Returns aggregated Bluesky metrics across all bots
 */
analyticsRouter.get("/combined", async (c) => {
  const range = c.req.query("range");
  const after = rangeToDate(range);

  const configService = c.get("configService");
  const db = configService.getDb();

  const conditions = [sql`1=1`];
  if (after) {
    conditions.push(gte(Schema.TweetMetrics.recordedAt, after));
  }

  const metrics = db
    .select()
    .from(Schema.TweetMetrics)
    .where(and(...conditions))
    .orderBy(
      desc(
        sql`${Schema.TweetMetrics.blueskyLikes} + ${Schema.TweetMetrics.blueskyReposts} + ${Schema.TweetMetrics.blueskyReplies} + ${Schema.TweetMetrics.blueskyQuotes}`,
      ),
    )
    .all();

  const totals = metrics.reduce(
    (acc, m) => ({
      likes: acc.likes + m.blueskyLikes,
      reposts: acc.reposts + m.blueskyReposts,
      replies: acc.replies + m.blueskyReplies,
      quotes: acc.quotes + m.blueskyQuotes,
    }),
    { likes: 0, reposts: 0, replies: 0, quotes: 0 },
  );

  return c.json({ metrics, totals, count: metrics.length });
});

/**
 * GET /api/analytics/:botId?range=day|week|month|all
 * Returns stored Bluesky metrics for a bot, sorted by total engagement
 */
analyticsRouter.get("/:botId", async (c) => {
  const botId = parseInt(c.req.param("botId"));
  if (isNaN(botId)) return c.json({ error: "Invalid bot ID" }, 400);

  const range = c.req.query("range");
  const after = rangeToDate(range);

  const configService = c.get("configService");
  const db = configService.getDb();

  let analyticsEnabled = true;
  try {
    const bot = await configService.getBotConfigById(botId);
    analyticsEnabled = bot.analyticsEnabled;
  } catch {
    return c.json({ error: "Bot not found" }, 404);
  }

  const conditions = [eq(Schema.TweetMetrics.botConfigId, botId)];
  if (after) {
    conditions.push(gte(Schema.TweetMetrics.recordedAt, after));
  }

  const metrics = db
    .select()
    .from(Schema.TweetMetrics)
    .where(and(...conditions))
    .orderBy(
      desc(
        sql`${Schema.TweetMetrics.blueskyLikes} + ${Schema.TweetMetrics.blueskyReposts} + ${Schema.TweetMetrics.blueskyReplies} + ${Schema.TweetMetrics.blueskyQuotes}`,
      ),
    )
    .all();

  const totals = metrics.reduce(
    (acc, m) => ({
      likes: acc.likes + m.blueskyLikes,
      reposts: acc.reposts + m.blueskyReposts,
      replies: acc.replies + m.blueskyReplies,
      quotes: acc.quotes + m.blueskyQuotes,
    }),
    { likes: 0, reposts: 0, replies: 0, quotes: 0 },
  );

  return c.json({ metrics, totals, count: metrics.length, analyticsEnabled });
});

/**
 * POST /api/analytics/:botId/refresh
 * Fetches fresh Bluesky engagement stats and upserts into TweetMetrics
 */
analyticsRouter.post("/:botId/refresh", async (c) => {
  const botId = parseInt(c.req.param("botId"));
  if (isNaN(botId)) return c.json({ error: "Invalid bot ID" }, 400);

  const configService = c.get("configService");
  const db = configService.getDb();

  let bot;
  try {
    bot = await configService.getBotConfigById(botId);
  } catch {
    return c.json({ error: "Bot not found" }, 404);
  }

  if (!bot.analyticsEnabled) {
    return c.json({ error: "Analytics is disabled for this bot" }, 403);
  }

  const bskyPlatform = bot.platforms.find(
    (p) => p.platformId === "bluesky" && p.enabled,
  );
  if (!bskyPlatform) {
    return c.json({ error: "No enabled Bluesky platform for this bot" }, 400);
  }

  const { BLUESKY_IDENTIFIER, BLUESKY_PASSWORD, BLUESKY_INSTANCE } =
    bskyPlatform.credentials;
  if (!BLUESKY_IDENTIFIER || !BLUESKY_PASSWORD) {
    return c.json({ error: "Bluesky credentials are incomplete" }, 400);
  }

  const instance = BLUESKY_INSTANCE || "bsky.social";
  // Strip protocol prefix if present (e.g. "https://bsky.social" → "bsky.social")
  const instanceHost = instance.replace(/^https?:\/\//, "");

  let did: string;
  try {
    const session = new CredentialSession(new URL(`https://${instanceHost}`));
    const agent = new AtpAgent(session);
    await agent.login({
      identifier: BLUESKY_IDENTIFIER,
      password: BLUESKY_PASSWORD,
    });

    const profileRes = await agent.getProfile({ actor: BLUESKY_IDENTIFIER });
    did = profileRes.data.did;

    // Fetch all bluesky TweetMap entries
    const tweetMaps = db
      .select()
      .from(Schema.TweetMap)
      .where(eq(Schema.TweetMap.platform, "bluesky"))
      .all();

    // Build URI -> tweetId map.
    // Prefer the stored AT URI (which is always correct); only include entries
    // whose URI belongs to this bot's DID so multi-bot setups stay accurate.
    const uriToTweetId = new Map<string, string>();
    for (const entry of tweetMaps) {
      try {
        const store = JSON.parse(entry.platformStore) as {
          rkey?: string;
          cid?: string;
          uri?: string;
        };
        const storedUri = store?.uri;
        let uri: string | null = null;
        if (storedUri && storedUri.startsWith(`at://${did}/`)) {
          // Use the precise URI that was stored at sync time
          uri = storedUri;
        } else if (store?.rkey) {
          // Fallback: construct URI from did + rkey
          uri = `at://${did}/app.bsky.feed.post/${store.rkey}`;
        }
        if (uri) {
          uriToTweetId.set(uri, entry.tweetId);
        }
      } catch {
        // Skip malformed entries
      }
    }

    const uris = [...uriToTweetId.keys()];
    if (uris.length === 0) {
      return c.json({ success: true, refreshed: 0 });
    }

    // Batch-fetch posts (Bluesky limit: 25 per request)
    const BATCH_SIZE = 25;
    let refreshed = 0;

    for (let i = 0; i < uris.length; i += BATCH_SIZE) {
      const batch = uris.slice(i, i + BATCH_SIZE);
      const result = await agent.app.bsky.feed.getPosts({ uris: batch });
      const posts = result.data?.posts ?? [];

      for (const post of posts) {
        const tweetId = uriToTweetId.get(post.uri);
        if (!tweetId) continue;

        await db
          .insert(Schema.TweetMetrics)
          .values({
            tweetId,
            botConfigId: botId,
            blueskyLikes: post.likeCount ?? 0,
            blueskyReposts: post.repostCount ?? 0,
            blueskyReplies: post.replyCount ?? 0,
            blueskyQuotes: post.quoteCount ?? 0,
            recordedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              Schema.TweetMetrics.tweetId,
              Schema.TweetMetrics.botConfigId,
            ],
            set: {
              blueskyLikes: post.likeCount ?? 0,
              blueskyReposts: post.repostCount ?? 0,
              blueskyReplies: post.replyCount ?? 0,
              blueskyQuotes: post.quoteCount ?? 0,
              recordedAt: new Date(),
            },
          })
          .run();
        refreshed++;
      }
    }

    return c.json({ success: true, refreshed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: `Refresh failed: ${message}` }, 500);
  }
});

export default analyticsRouter;
