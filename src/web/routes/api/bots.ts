import { db as globalDb, Schema } from "db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { TransformRulesConfigSchema } from "sync/transforms/transform-types";
import { z } from "zod";

import { requireAuth } from "../../middleware/auth";
import { BotManager } from "../../services/bot-manager";
import { ConfigService } from "../../services/config-service";
// Compose platform routes under the bots router so they share the same mount point
import platformsRouter from "./platforms";

const botsRouter = new Hono<{
  Variables: {
    configService: ConfigService;
    botManager: BotManager;
  };
}>();

// Apply auth middleware to all routes
botsRouter.use("*", requireAuth);

// Schemas
const createBotSchema = z.object({
  twitterHandle: z.string().min(1, "Twitter handle is required"),
  enabled: z.boolean().optional(),
  syncFrequencyMin: z.number().int().min(1).optional(),
  adaptivePolling: z.boolean().optional(),
  syncPosts: z.boolean().optional(),
  syncProfileDescription: z.boolean().optional(),
  syncProfilePicture: z.boolean().optional(),
  syncProfileName: z.boolean().optional(),
  syncProfileHeader: z.boolean().optional(),
  backdateBlueskyPosts: z.boolean().optional(),
  analyticsEnabled: z.boolean().optional(),
  timezone: z.string().optional(),
});

const updateBotSchema = createBotSchema.partial();

/**
 * GET /api/bots
 * List all bots
 */
botsRouter.get("/", async (c) => {
  const configService = c.get("configService");
  const botManager = c.get("botManager");

  const bots = await configService.getAllBotConfigs();

  // Add runtime status
  const botsWithStatus = await Promise.all(
    bots.map(async (bot) => {
      const status = botManager.getStatus(bot.id);
      return {
        ...bot,
        status: status || { status: "stopped" },
        isRunning: botManager.isRunning(bot.id),
      };
    }),
  );

  return c.json({ bots: botsWithStatus });
});

/**
 * GET /api/bots/:id
 * Get bot details
 */
botsRouter.get("/:id", async (c) => {
  const configService = c.get("configService");
  const botManager = c.get("botManager");
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    const bot = await configService.getBotConfigById(id);
    const status = botManager.getStatus(id);

    return c.json({
      bot: {
        ...bot,
        status: status || { status: "stopped" },
        isRunning: botManager.isRunning(id),
      },
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 404);
  }
});

/**
 * POST /api/bots
 * Create a new bot
 */
botsRouter.post("/", async (c) => {
  const configService = c.get("configService");

  try {
    const body = await c.req.json();
    const data = createBotSchema.parse(body);

    const bot = await configService.createBotConfig(data);

    return c.json({ bot }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Validation error",
          details: error.errors,
        },
        400,
      );
    }

    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * PUT /api/bots/:id
 * Update a bot
 */
botsRouter.put("/:id", async (c) => {
  const configService = c.get("configService");
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    const body = await c.req.json();
    const data = updateBotSchema.parse(body);

    const bot = await configService.updateBotConfig(id, data);

    return c.json({ bot });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Validation error",
          details: error.errors,
        },
        400,
      );
    }

    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * DELETE /api/bots/:id
 * Delete a bot
 */
botsRouter.delete("/:id", async (c) => {
  const configService = c.get("configService");
  const botManager = c.get("botManager");
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    // Stop bot if running
    if (botManager.isRunning(id)) {
      botManager.stop(id);
    }

    const purge = c.req.query("purge") === "true";
    if (purge) {
      await configService.deleteBotConfigWithData(id);
    } else {
      await configService.deleteBotConfig(id);
    }

    return c.json({ success: true, message: "Bot deleted" });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * POST /api/bots/:id/rebuild
 * Clear sync history so all tweets are re-posted on next sync
 */
botsRouter.post("/:id/rebuild", async (c) => {
  const botManager = c.get("botManager");
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    const running = botManager.isRunning(id);
    if (!running) {
      return c.json(
        { error: "Bot must be running to rebuild. Start it first." },
        400,
      );
    }
    await botManager.rebuild(id);
    await botManager.triggerSync(id);
    return c.json({
      success: true,
      message: "Rebuild triggered. All tweets will be re-synced.",
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * POST /api/bots/:id/start
 * Start a bot
 */
botsRouter.post("/:id/start", async (c) => {
  const botManager = c.get("botManager");
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    await botManager.start(id);
    return c.json({ success: true, message: "Bot started" });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * POST /api/bots/:id/stop
 * Stop a bot
 */
botsRouter.post("/:id/stop", async (c) => {
  const botManager = c.get("botManager");
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    botManager.stop(id);
    return c.json({ success: true, message: "Bot stopped" });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * POST /api/bots/start-all
 * Start all enabled bots
 */
botsRouter.post("/start-all", async (c) => {
  const botManager = c.get("botManager");

  try {
    await botManager.startAll();
    return c.json({ success: true, message: "All bots started" });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * POST /api/bots/stop-all
 * Stop all running bots
 */
botsRouter.post("/stop-all", async (c) => {
  const botManager = c.get("botManager");

  try {
    botManager.stopAll();
    return c.json({ success: true, message: "All bots stopped" });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * GET /api/bots/:id/logs
 * Get sync logs for a bot
 */
botsRouter.get("/:id/logs", async (c) => {
  const configService = c.get("configService");
  const id = parseInt(c.req.param("id"));
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") || "100") || 100, 1),
    500,
  );
  const offset = Math.max(parseInt(c.req.query("offset") || "0") || 0, 0);

  if (isNaN(id)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    const logs = await configService.getSyncLogs(id, limit, offset);
    return c.json({ logs });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * GET /api/bots/:id/transforms
 * Get transform rules for a bot
 */
botsRouter.get("/:id/transforms", async (c) => {
  const configService = c.get("configService");
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    const rules = await configService.getTransformRules(id);
    return c.json({ rules: rules ?? { global: [], platforms: {} } });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * PUT /api/bots/:id/transforms
 * Update transform rules for a bot
 */
botsRouter.put("/:id/transforms", async (c) => {
  const configService = c.get("configService");
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    const body = await c.req.json();
    const rules = TransformRulesConfigSchema.parse(body);
    await configService.setTransformRules(id, rules);
    return c.json({ rules });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation error", details: error.errors }, 400);
    }
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * GET /api/bots/:id/blackouts
 * Get blackout windows for a bot
 */
botsRouter.get("/:id/blackouts", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid bot ID" }, 400);
  const windows = await globalDb
    .select()
    .from(Schema.BlackoutWindows)
    .where(eq(Schema.BlackoutWindows.botConfigId, id))
    .all();
  return c.json({ blackouts: windows });
});

const blackoutSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  startHour: z.number().int().min(0).max(23),
  startMinute: z.number().int().min(0).max(59).optional(),
  endHour: z.number().int().min(0).max(23),
  endMinute: z.number().int().min(0).max(59).optional(),
});

/**
 * POST /api/bots/:id/blackouts
 * Add a blackout window
 */
botsRouter.post("/:id/blackouts", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid bot ID" }, 400);
  try {
    const body = await c.req.json();
    const data = blackoutSchema.parse(body);
    const result = await globalDb
      .insert(Schema.BlackoutWindows)
      .values({
        botConfigId: id,
        dayOfWeek: data.dayOfWeek,
        startHour: data.startHour,
        startMinute: data.startMinute ?? 0,
        endHour: data.endHour,
        endMinute: data.endMinute ?? 0,
      })
      .returning();
    return c.json({ blackout: result[0] }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation error", details: error.errors }, 400);
    }
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * DELETE /api/bots/:id/blackouts/:windowId
 * Delete a blackout window
 */
botsRouter.delete("/:id/blackouts/:windowId", async (c) => {
  const windowId = parseInt(c.req.param("windowId"));
  if (isNaN(windowId)) return c.json({ error: "Invalid window ID" }, 400);
  await globalDb
    .delete(Schema.BlackoutWindows)
    .where(eq(Schema.BlackoutWindows.id, windowId));
  return c.json({ success: true });
});

/**
 * POST /api/bots/bulk-start
 * Start multiple bots by ID
 */
botsRouter.post("/bulk-start", async (c) => {
  const botManager = c.get("botManager");
  try {
    const { botIds } = (await c.req.json()) as { botIds: number[] };
    const results: Array<{ botId: number; success: boolean; error?: string }> =
      [];
    for (const id of botIds) {
      try {
        if (!botManager.isRunning(id)) {
          await botManager.start(id);
        }
        results.push({ botId: id, success: true });
      } catch (error) {
        results.push({
          botId: id,
          success: false,
          error: (error as Error).message,
        });
      }
    }
    return c.json({ results });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * POST /api/bots/bulk-stop
 * Stop multiple bots by ID
 */
botsRouter.post("/bulk-stop", async (c) => {
  const botManager = c.get("botManager");
  try {
    const { botIds } = (await c.req.json()) as { botIds: number[] };
    const results: Array<{ botId: number; success: boolean; error?: string }> =
      [];
    for (const id of botIds) {
      try {
        if (botManager.isRunning(id)) {
          botManager.stop(id);
        }
        results.push({ botId: id, success: true });
      } catch (error) {
        results.push({
          botId: id,
          success: false,
          error: (error as Error).message,
        });
      }
    }
    return c.json({ results });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * POST /api/bots/:id/clone
 * Clone a bot config with a new Twitter handle
 */
botsRouter.post("/:id/clone", async (c) => {
  const configService = c.get("configService");
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid bot ID" }, 400);

  try {
    const { twitterHandle } = (await c.req.json()) as {
      twitterHandle: string;
    };
    if (!twitterHandle) {
      return c.json({ error: "twitterHandle is required" }, 400);
    }
    const source = await configService.getBotConfigById(id);
    const newBot = await configService.createBotConfig({
      twitterHandle,
      enabled: false,
      syncFrequencyMin: source.syncFrequencyMin,
      adaptivePolling: source.adaptivePolling,
      syncPosts: source.syncPosts,
      syncProfileDescription: source.syncProfileDescription,
      syncProfilePicture: source.syncProfilePicture,
      syncProfileName: source.syncProfileName,
      syncProfileHeader: source.syncProfileHeader,
      backdateBlueskyPosts: source.backdateBlueskyPosts,
      analyticsEnabled: source.analyticsEnabled,
      timezone: source.timezone,
    });
    return c.json({ bot: newBot }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

botsRouter.route("/", platformsRouter);

export default botsRouter;
