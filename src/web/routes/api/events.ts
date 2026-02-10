import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { requireAuth } from "../../middleware/auth";
import { BotManager } from "../../services/bot-manager";

const eventsRouter = new Hono<{
  Variables: {
    botManager: BotManager;
  };
}>();

// Apply auth middleware
eventsRouter.use("*", requireAuth);

/**
 * GET /api/events
 * Server-Sent Events endpoint for real-time updates
 */
eventsRouter.get("/", async (c) => {
  const botManager = c.get("botManager");

  return streamSSE(c, async (stream) => {
    // Send initial connection message
    await stream.writeSSE({
      data: JSON.stringify({
        type: "connected",
        timestamp: new Date().toISOString(),
      }),
      event: "connected",
    });

    // Log event handler
    const logHandler = (log: any) => {
      stream.writeSSE({
        data: JSON.stringify({
          type: "log",
          ...log,
        }),
        event: "log",
      });
    };

    // Status change handler
    const statusHandler = (status: any) => {
      stream.writeSSE({
        data: JSON.stringify({
          type: "statusChange",
          ...status,
        }),
        event: "statusChange",
      });
    };

    // Bot started handler
    const botStartedHandler = (botId: number) => {
      stream.writeSSE({
        data: JSON.stringify({
          type: "botStarted",
          botId,
          timestamp: new Date().toISOString(),
        }),
        event: "botStarted",
      });
    };

    // Bot stopped handler
    const botStoppedHandler = (botId: number) => {
      stream.writeSSE({
        data: JSON.stringify({
          type: "botStopped",
          botId,
          timestamp: new Date().toISOString(),
        }),
        event: "botStopped",
      });
    };

    // Register event listeners
    botManager.on("log", logHandler);
    botManager.on("statusChange", statusHandler);
    botManager.on("botStarted", botStartedHandler);
    botManager.on("botStopped", botStoppedHandler);

    // Send keepalive every 30 seconds
    const keepaliveInterval = setInterval(() => {
      stream.writeSSE({
        data: JSON.stringify({
          type: "keepalive",
          timestamp: new Date().toISOString(),
        }),
        event: "keepalive",
      });
    }, 30000);

    // Clean up on disconnect
    stream.onAbort(() => {
      clearInterval(keepaliveInterval);
      botManager.off("log", logHandler);
      botManager.off("statusChange", statusHandler);
      botManager.off("botStarted", botStartedHandler);
      botManager.off("botStopped", botStoppedHandler);
    });

    // Keep the stream open
    await stream.sleep(1000000000);
  });
});

export default eventsRouter;
