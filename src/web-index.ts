import { existsSync } from "fs";
import { join } from "path";
import { db, Schema } from "db";
import { createServer } from "./web/server";
import { importFromEnv } from "./web/services/config-migration";
import { serve } from "@hono/node-server";

const WEB_PORT = parseInt(process.env.WEB_PORT || "3000");

// Validate required environment variables
if (!process.env.WEB_ADMIN_PASSWORD) {
    console.error(
        "ERROR: WEB_ADMIN_PASSWORD environment variable is required",
    );
    console.error("Please set a secure admin password:");
    console.error("  export WEB_ADMIN_PASSWORD=your_secure_password");
    process.exit(1);
}

console.log(`
  ╔═══════════════════════════════════════╗
  ║   🤖 RoccoBots Web Interface v2.0    ║
  ╚═══════════════════════════════════════╝
`);

console.log("Starting web server...");

// Create server
const { app, botManager, configService, port } = createServer({
    db,
    port: WEB_PORT,
});

// Auto-import bots from .env if database is empty
const envPath = join(process.cwd(), ".env");
const existingBots = await db.select().from(Schema.BotConfigs).all();

if (existingBots.length === 0 && existsSync(envPath)) {
    console.log("No bots configured — checking .env for import...");
    const result = await importFromEnv(configService, envPath);
    if (result.created > 0) {
        console.log(`Imported ${result.created} bot(s) from .env`);
    } else if (
        result.errors.length === 1 &&
        result.errors[0].includes("No TWITTER_HANDLE")
    ) {
        console.log("No Twitter handles found in .env — skipping auto-import");
    } else if (result.errors.length > 0) {
        console.warn("Import errors:", result.errors);
    }
}

// Start server
console.log(`\n🚀 Server starting on http://localhost:${port}`);
console.log(`\n📝 Login with your WEB_ADMIN_PASSWORD\n`);

serve({
    fetch: app.fetch,
    port,
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\nShutting down gracefully...");
    botManager.stopAll();
    process.exit(0);
});

process.on("SIGTERM", () => {
    console.log("\nShutting down gracefully...");
    botManager.stopAll();
    process.exit(0);
});
