import { Hono } from "hono";
import { z } from "zod";

import { requireAuth } from "../../middleware/auth";
import { ConfigService } from "../../services/config-service";

const mentionsRouter = new Hono<{
  Variables: {
    configService: ConfigService;
  };
}>();

mentionsRouter.use("*", requireAuth);

const upsertSchema = z.object({
  twitterHandle: z.string().min(1),
  blueskyHandle: z.string().min(1),
});

const setBotMapSchema = z.object({
  mentionOverrides: z.record(z.string(), z.string()),
});

/**
 * GET /api/mentions
 * List global mention overrides.
 */
mentionsRouter.get("/", async (c) => {
  const configService = c.get("configService");
  const map = await configService.getGlobalMentionOverrides();
  return c.json({ mentionOverrides: map });
});

/**
 * PUT /api/mentions
 * Upsert a single global mapping. Body: { twitterHandle, blueskyHandle }.
 */
mentionsRouter.put("/", async (c) => {
  const configService = c.get("configService");
  try {
    const body = await c.req.json();
    const { twitterHandle, blueskyHandle } = upsertSchema.parse(body);
    await configService.upsertGlobalMentionOverride(
      twitterHandle,
      blueskyHandle,
    );
    const map = await configService.getGlobalMentionOverrides();
    return c.json({ mentionOverrides: map });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation error", details: error.issues }, 400);
    }
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * DELETE /api/mentions/:twitterHandle
 * Remove a global mapping.
 */
mentionsRouter.delete("/:twitterHandle", async (c) => {
  const configService = c.get("configService");
  const handle = c.req.param("twitterHandle");
  if (!handle) return c.json({ error: "Handle required" }, 400);
  await configService.deleteGlobalMentionOverride(handle);
  const map = await configService.getGlobalMentionOverrides();
  return c.json({ mentionOverrides: map });
});

/**
 * GET /api/bots/:id/mentions
 * Get per-bot mention overrides.
 */
mentionsRouter.get("/bot/:id", async (c) => {
  const configService = c.get("configService");
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid bot ID" }, 400);
  try {
    const map = await configService.getBotMentionOverrides(id);
    return c.json({ mentionOverrides: map });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * PUT /api/bots/:id/mentions
 * Replace per-bot mention overrides. Body: { mentionOverrides: { twitter: bluesky } }.
 */
mentionsRouter.put("/bot/:id", async (c) => {
  const configService = c.get("configService");
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid bot ID" }, 400);
  try {
    const body = await c.req.json();
    const { mentionOverrides } = setBotMapSchema.parse(body);
    await configService.setBotMentionOverrides(id, mentionOverrides);
    const map = await configService.getBotMentionOverrides(id);
    return c.json({ mentionOverrides: map });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation error", details: error.issues }, 400);
    }
    return c.json({ error: (error as Error).message }, 400);
  }
});

export default mentionsRouter;
