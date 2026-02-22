import { DBType } from "db";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";

import { requireAuth, sessionMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error";
import authRouter from "./routes/api/auth";
import botsRouter from "./routes/api/bots";
import commandsRouter from "./routes/api/commands";
import eventsRouter from "./routes/api/events";
import systemRouter from "./routes/api/system";
import { BotManager } from "./services/bot-manager";
import { importFromEnv } from "./services/config-migration";
import { ConfigService } from "./services/config-service";
import { botFormPage } from "./views/bot-form";
import { dashboardPage } from "./views/dashboard";
import { loginPage } from "./views/login";
import { logsPage } from "./views/logs";
import { settingsPage } from "./views/settings";

export interface ServerOptions {
  db: DBType;
  port?: number;
}

/**
 * Create and configure the web server
 */
export function createServer(options: ServerOptions) {
  const { db, port = 3000 } = options;

  const app = new Hono();

  // Initialize services
  const configService = new ConfigService(db);
  const botManager = new BotManager(db, configService);

  // Apply global middleware
  app.use("*", errorHandler);
  app.use("*", sessionMiddleware);

  // Inject services into context
  app.use("*", async (c, next) => {
    c.set("botManager", botManager);
    c.set("configService", configService);
    await next();
  });

  // Serve static files
  app.use("/static/*", serveStatic({ root: "./src/web" }));

  // API routes
  app.route("/api/auth", authRouter);
  app.route("/api/bots", botsRouter);
  app.route("/api/bots", commandsRouter);
  app.route("/api/system", systemRouter);
  app.route("/api/events", eventsRouter);

  // Config import endpoint
  app.post("/api/config/import-env", requireAuth, async (c) => {
    try {
      const result = await importFromEnv(configService);
      return c.json({
        success: true,
        created: result.created,
        errors: result.errors,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: (error as Error).message,
        },
        500,
      );
    }
  });

  // --- HTML Pages ---

  app.get("/login", async (_c) => {
    return _c.html(loginPage());
  });

  app.get("/", async (c) => {
    const session = c.get("session") as any;
    const isAuthenticated = session?.authenticated ?? false;
    if (!isAuthenticated) return c.redirect("/login");
    return c.html(dashboardPage());
  });

  app.get("/bots/new", requireAuth, async (_c) => {
    return _c.html(botFormPage());
  });

  app.get("/bots/:id", requireAuth, async (c) => {
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) return c.redirect("/");

    try {
      const bot = await configService.getBotConfigById(id);
      if (!bot) return c.redirect("/");
      return c.html(botFormPage(bot));
    } catch (_error) {
      return c.redirect("/");
    }
  });

  app.get("/settings", requireAuth, async (_c) => {
    const auth = await configService.getTwitterAuth();
    return _c.html(
      settingsPage({
        twitterAuthConfigured: !!auth,
        twitterUsername: auth?.username ?? null,
      }),
    );
  });

  app.get("/bots/:id/logs", requireAuth, async (c) => {
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) return c.redirect("/");

    try {
      const bot = await configService.getBotConfigById(id);
      if (!bot) return c.redirect("/");
      return c.html(logsPage(id, bot.twitterHandle));
    } catch (_error) {
      return c.redirect("/");
    }
  });

  return { app, botManager, configService, port };
}
