import AtpAgent, { CredentialSession } from "@atproto/api";
import { Schema } from "db";
import { desc, eq, sql } from "drizzle-orm";
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

/**
 * GET /api/analytics/:botId
 * Returns stored Bluesky metrics for a bot, sorted by total engagement
 */
analyticsRouter.get("/:botId", async (c) => {
  const botId = parseInt(c.req.param("botId"));
  if (isNaN(botId)) return c.json({ error: "Invalid bot ID" }, 400);

  const configService = c.get("configService");
  const db = configService.getDb();

  let analyticsEnabled = true;
  try {
    const bot = await configService.getBotConfigById(botId);
    analyticsEnabled = bot.analyticsEnabled;
  } catch {
    return c.json({ error: "Bot not found" }, 404);
  }

  const metrics = db
    .select()
    .from(Schema.TweetMetrics)
    .where(eq(Schema.TweetMetrics.botConfigId, botId))
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

  try {
    const session = new CredentialSession(new URL(`https://${instance}`));
    const agent = new AtpAgent(session);
    await agent.login({
      identifier: BLUESKY_IDENTIFIER,
      password: BLUESKY_PASSWORD,
    });

    const profileRes = await agent.getProfile({ actor: BLUESKY_IDENTIFIER });
    const did = profileRes.data.did;

    // Fetch all bluesky TweetMap entries
    const tweetMaps = db
      .select()
      .from(Schema.TweetMap)
      .where(eq(Schema.TweetMap.platform, "bluesky"))
      .all();

    // Build URI -> tweetId map
    const uriToTweetId = new Map<string, string>();
    for (const entry of tweetMaps) {
      try {
        const store = JSON.parse(entry.platformStore) as {
          rkey?: string;
          cid?: string;
        };
        if (store?.rkey) {
          const uri = `at://${did}/app.bsky.feed.post/${store.rkey}`;
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
      const result = await agent.api.app.bsky.feed.getPosts({ uris: batch });

      for (const post of result.data.posts) {
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
    return c.json(
      { error: `Refresh failed: ${(error as Error).message}` },
      500,
    );
  }
});

export default analyticsRouter;
