import { Hono } from "hono";
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
  syncPosts: z.boolean().optional(),
  syncProfileDescription: z.boolean().optional(),
  syncProfilePicture: z.boolean().optional(),
  syncProfileName: z.boolean().optional(),
  syncProfileHeader: z.boolean().optional(),
  backdateBlueskyPosts: z.boolean().optional(),
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

    await configService.deleteBotConfig(id);

    return c.json({ success: true, message: "Bot deleted" });
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
  const limit = parseInt(c.req.query("limit") || "100");
  const offset = parseInt(c.req.query("offset") || "0");

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

botsRouter.route("/", platformsRouter);

export default botsRouter;
