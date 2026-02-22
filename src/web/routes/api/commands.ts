import { Hono } from "hono";
import { z } from "zod";

import { requireAuth } from "../../middleware/auth";
import { ConfigService } from "../../services/config-service";

const commandsRouter = new Hono<{
  Variables: {
    configService: ConfigService;
  };
}>();

commandsRouter.use("*", requireAuth);

const upsertCommandConfigSchema = z.object({
  enabled: z.boolean().optional(),
  trustedHandles: z.array(z.string()).optional(),
  pollIntervalSec: z.number().int().min(10).optional(),
  responseMessages: z
    .object({
      restart: z.string().optional(),
      sync: z.string().optional(),
      source: z.string().optional(),
      sourceChanged: z.string().optional(),
      unauthorized: z.string().optional(),
      error: z.string().optional(),
      unknown: z.string().optional(),
    })
    .optional(),
});

/**
 * GET /api/bots/:id/commands
 * Get command config for a bot
 */
commandsRouter.get("/:id/commands", async (c) => {
  const configService = c.get("configService");
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    const config = await configService.getCommandConfig(id);
    return c.json({ commands: config });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * PUT /api/bots/:id/commands
 * Create or update command config for a bot
 */
commandsRouter.put("/:id/commands", async (c) => {
  const configService = c.get("configService");
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json({ error: "Invalid bot ID" }, 400);
  }

  try {
    const body = await c.req.json();
    const data = upsertCommandConfigSchema.parse(body);

    const config = await configService.upsertCommandConfig(id, data);
    return c.json({ commands: config });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation error", details: error.issues }, 400);
    }
    return c.json({ error: (error as Error).message }, 400);
  }
});

export default commandsRouter;
