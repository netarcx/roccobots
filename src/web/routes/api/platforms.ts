import { Hono } from "hono";
import { z } from "zod";

import { requireAuth } from "../../middleware/auth";
import { ConfigService } from "../../services/config-service";

const platformsRouter = new Hono<{
  Variables: {
    configService: ConfigService;
  };
}>();

// Apply auth middleware to all routes
platformsRouter.use("*", requireAuth);

// Schemas
const createPlatformSchema = z.object({
  platformId: z.enum(["bluesky", "mastodon", "misskey", "discord"]),
  enabled: z.boolean().optional(),
  credentials: z.record(z.string(), z.string()),
});

const updatePlatformSchema = z.object({
  enabled: z.boolean().optional(),
  credentials: z.record(z.string(), z.string()).optional(),
});

/**
 * GET /api/bots/:botId/platforms
 * List platforms for a bot
 */
platformsRouter.get("/:botId/platforms", async (c) => {
  const configService = c.get("configService");
  const botId = parseInt(c.req.param("botId"));

  if (isNaN(botId)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    const platforms = await configService.getPlatformConfigsByBotId(botId);
    return c.json({ platforms });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * POST /api/bots/:botId/platforms
 * Add a platform to a bot
 */
platformsRouter.post("/:botId/platforms", async (c) => {
  const configService = c.get("configService");
  const botId = parseInt(c.req.param("botId"));

  if (isNaN(botId)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    const body = await c.req.json();
    const data = createPlatformSchema.parse(body);

    const platform = await configService.createPlatformConfig({
      botConfigId: botId,
      ...data,
    });

    return c.json({ platform }, 201);
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
 * PUT /api/bots/:botId/platforms/:platformId
 * Update a platform configuration
 */
platformsRouter.put("/:botId/platforms/:platformId", async (c) => {
  const configService = c.get("configService");
  const botId = parseInt(c.req.param("botId"));
  const platformId = c.req.param("platformId");

  if (isNaN(botId)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    const body = await c.req.json();
    const data = updatePlatformSchema.parse(body);

    const platform = await configService.updatePlatformConfig(
      botId,
      platformId,
      data,
    );

    return c.json({ platform });
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
 * DELETE /api/bots/:botId/platforms/:platformId
 * Remove a platform from a bot
 */
platformsRouter.delete("/:botId/platforms/:platformId", async (c) => {
  const configService = c.get("configService");
  const botId = parseInt(c.req.param("botId"));
  const platformId = c.req.param("platformId");

  if (isNaN(botId)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    await configService.deletePlatformConfig(botId, platformId);
    return c.json({ success: true, message: "Platform removed" });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

export default platformsRouter;
