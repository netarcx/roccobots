import { db } from "db";
import { createTwitterClient } from "sync/x-client";
import { TWITTER_PASSWORD, TWITTER_USERNAME } from "./env";
import { createServer } from "./web/server";
import { serve } from "@hono/node-server";

const WEB_PORT = parseInt(process.env.WEB_PORT || "3000");

// Validate required environment variables
if (!process.env.WEB_ADMIN_PASSWORD) {
  console.error("ERROR: WEB_ADMIN_PASSWORD environment variable is required");
  console.error("Please set a secure admin password:");
  console.error("  export WEB_ADMIN_PASSWORD=your_secure_password");
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
  console.error("ERROR: ENCRYPTION_KEY environment variable is required");
  console.error("Generate one with: openssl rand -hex 32");
  console.error("Then set it:");
  console.error("  export ENCRYPTION_KEY=<generated_key>");
  process.exit(1);
}

console.log(`
  ╔═══════════════════════════════════════╗
  ║   🤖 RoccoBots Web Interface v2.0    ║
  ╚═══════════════════════════════════════╝
`);

console.log("Starting web server...");

// Create Twitter client (guest mode — each bot uses its own credentials)
console.log("Creating Twitter client...");
const xClient = await createTwitterClient({
  db,
});

console.log("Twitter client created (guest mode)");

// Create server
const { app, botManager, configService, port } = createServer({
  db,
  xClient,
  port: WEB_PORT,
});

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
