import { Hono } from "hono";
import { requireAuth } from "../../middleware/auth";
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

export default systemRouter;
