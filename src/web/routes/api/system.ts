import { db } from "db";
import { Hono } from "hono";
import { z } from "zod";

import { requireAuth } from "../../middleware/auth";
import { exportBackup, importBackup } from "../../services/backup-service";
import { BotManager } from "../../services/bot-manager";
import { ConfigService } from "../../services/config-service";

const systemRouter = new Hono<{
  Variables: {
    botManager: BotManager;
    configService: ConfigService;
  };
}>();

// Apply auth middleware to all routes
systemRouter.use("*", requireAuth);

/**
 * GET /api/system/status
 * Get system overview
 */
systemRouter.get("/status", async (c) => {
  const botManager = c.get("botManager");
  const configService = c.get("configService");

  try {
    const allBots = await configService.getAllBotConfigs();
    const runningBots = allBots.filter((bot) => botManager.isRunning(bot.id));

    const totalPlatforms = allBots.reduce(
      (sum, bot) => sum + bot.platforms.length,
      0,
    );

    return c.json({
      status: "running",
      totalBots: allBots.length,
      runningBots: runningBots.length,
      stoppedBots: allBots.length - runningBots.length,
      totalPlatforms,
      uptime: process.uptime(),
      nodeVersion: process.version,
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500);
  }
});

/**
 * GET /api/system/settings/twitter-auth
 * Get Twitter auth status (username only, never password)
 */
systemRouter.get("/settings/twitter-auth", async (c) => {
  const configService = c.get("configService");

  try {
    const auth = await configService.getTwitterAuth();
    return c.json({
      configured: !!auth,
      username: auth?.username ?? null,
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500);
  }
});

const twitterAuthSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

/**
 * PUT /api/system/settings/twitter-auth
 * Set/update global Twitter auth credentials
 */
systemRouter.put("/settings/twitter-auth", async (c) => {
  const configService = c.get("configService");

  try {
    const body = await c.req.json();
    const data = twitterAuthSchema.parse(body);

    await configService.setTwitterAuth(data.username, data.password);

    return c.json({ success: true, username: data.username });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation error", details: error.errors }, 400);
    }
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * GET /api/system/backup
 * Export all bot configs, credentials, and sync state as a JSON file
 */
systemRouter.get("/backup", async (c) => {
  const configService = c.get("configService");

  try {
    const backup = await exportBackup(configService, db);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `roccobots-backup-${date}.json`;

    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    c.header("Content-Type", "application/json");
    return c.body(JSON.stringify(backup, null, 2));
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500);
  }
});

/**
 * POST /api/system/restore
 * Import bot configs, credentials, and sync state from a JSON backup.
 * All bots must be stopped before restoring.
 */
systemRouter.post("/restore", async (c) => {
  const botManager = c.get("botManager");
  const configService = c.get("configService");

  try {
    // Check that no bots are running
    const allBots = await configService.getAllBotConfigs();
    const hasRunning = allBots.some((bot) => botManager.isRunning(bot.id));
    if (hasRunning) {
      return c.json(
        { error: "All bots must be stopped before restoring a backup" },
        400,
      );
    }

    const body = await c.req.json();
    const result = await importBackup(configService, db, body);
    return c.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        { error: "Invalid backup format", details: error.errors },
        400,
      );
    }
    return c.json({ error: (error as Error).message }, 400);
  }
});

export default systemRouter;
