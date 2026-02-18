import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { DBType } from "db";
import { sessionMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error";
import { BotManager } from "./services/bot-manager";
import { ConfigService } from "./services/config-service";
import authRouter from "./routes/api/auth";
import botsRouter from "./routes/api/bots";
import platformsRouter from "./routes/api/platforms";
import systemRouter from "./routes/api/system";
import eventsRouter from "./routes/api/events";
import { importFromEnv } from "./services/config-migration";
import { requireAuth } from "./middleware/auth";

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
  const botManager = new BotManager(db);
  const configService = new ConfigService(db);

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
  app.route("/api", platformsRouter);
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

  // Simple HTML pages (for now, will be replaced with proper views)
  app.get("/", async (c) => {
    const session = c.get("session") as any;
    const isAuthenticated = session?.authenticated ?? false;

    if (!isAuthenticated) {
      return c.redirect("/login");
    }

    // Simple dashboard HTML
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>RoccoBots Dashboard</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              max-width: 1200px;
              margin: 0 auto;
              padding: 20px;
              background: #0f172a;
              color: #e2e8f0;
            }
            h1 { color: #60a5fa; }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 30px;
            }
            .btn {
              background: #3b82f6;
              color: white;
              padding: 10px 20px;
              border: none;
              border-radius: 5px;
              cursor: pointer;
              text-decoration: none;
              display: inline-block;
            }
            .btn:hover { background: #2563eb; }
            .btn-danger { background: #ef4444; }
            .btn-danger:hover { background: #dc2626; }
            .btn-success { background: #10b981; }
            .btn-success:hover { background: #059669; }
            #bots-list {
              display: grid;
              gap: 20px;
            }
            .bot-card {
              background: #1e293b;
              padding: 20px;
              border-radius: 8px;
              border: 1px solid #334155;
            }
            .bot-status {
              display: inline-block;
              padding: 4px 12px;
              border-radius: 12px;
              font-size: 12px;
              font-weight: bold;
            }
            .bot-status.running { background: #10b981; color: white; }
            .bot-status.stopped { background: #6b7280; color: white; }
            .bot-status.error { background: #ef4444; color: white; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>🤖 RoccoBots Dashboard</h1>
            <div>
              <button class="btn btn-success" onclick="startAll()">Start All</button>
              <button class="btn btn-danger" onclick="stopAll()">Stop All</button>
              <button class="btn" onclick="logout()">Logout</button>
            </div>
          </div>

          <div style="margin-bottom: 20px;">
            <a href="/bots/new" class="btn">➕ Add New Bot</a>
            <button class="btn" onclick="importEnv()">📥 Import from .env</button>
          </div>

          <div id="bots-list">Loading bots...</div>

          <script>
            async function loadBots() {
              const res = await fetch('/api/bots');
              const data = await res.json();
              const list = document.getElementById('bots-list');

              if (data.bots.length === 0) {
                list.innerHTML = '<p>No bots configured. Add one to get started!</p>';
                return;
              }

              list.innerHTML = data.bots.map(bot => \`
                <div class="bot-card">
                  <h3>@\${bot.twitterHandle}</h3>
                  <span class="bot-status \${bot.status.status}">\${bot.status.status}</span>
                  <p>Sync frequency: \${bot.syncFrequencyMin} minutes</p>
                  <p>Platforms: \${bot.platforms.length}</p>
                  <div>
                    \${bot.isRunning
                      ? '<button class="btn btn-danger" onclick="stopBot(' + bot.id + ')">Stop</button>'
                      : '<button class="btn btn-success" onclick="startBot(' + bot.id + ')">Start</button>'
                    }
                    <a href="/bots/\${bot.id}" class="btn">Edit</a>
                    <button class="btn btn-danger" onclick="deleteBot(\${bot.id})">Delete</button>
                  </div>
                </div>
              \`).join('');
            }

            async function startBot(id) {
              await fetch(\`/api/bots/\${id}/start\`, { method: 'POST' });
              loadBots();
            }

            async function stopBot(id) {
              await fetch(\`/api/bots/\${id}/stop\`, { method: 'POST' });
              loadBots();
            }

            async function deleteBot(id) {
              if (confirm('Are you sure you want to delete this bot?')) {
                await fetch(\`/api/bots/\${id}\`, { method: 'DELETE' });
                loadBots();
              }
            }

            async function startAll() {
              await fetch('/api/bots/start-all', { method: 'POST' });
              loadBots();
            }

            async function stopAll() {
              await fetch('/api/bots/stop-all', { method: 'POST' });
              loadBots();
            }

            async function logout() {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location = '/login';
            }

            async function importEnv() {
              const res = await fetch('/api/config/import-env', { method: 'POST' });
              const data = await res.json();
              alert(\`Imported \${data.created} bots. Errors: \${data.errors.length}\`);
              loadBots();
            }

            loadBots();
            setInterval(loadBots, 5000); // Refresh every 5 seconds
          </script>
        </body>
      </html>
    `);
  });

  app.get("/login", async (c) => {
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Login - RoccoBots</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              background: #0f172a;
              color: #e2e8f0;
              margin: 0;
            }
            .login-container {
              background: #1e293b;
              padding: 40px;
              border-radius: 8px;
              border: 1px solid #334155;
              max-width: 400px;
              width: 100%;
            }
            h1 {
              color: #60a5fa;
              margin-bottom: 30px;
              text-align: center;
            }
            .form-group {
              margin-bottom: 20px;
            }
            label {
              display: block;
              margin-bottom: 5px;
              font-weight: 500;
            }
            input {
              width: 100%;
              padding: 10px;
              border: 1px solid #334155;
              border-radius: 5px;
              background: #0f172a;
              color: #e2e8f0;
              box-sizing: border-box;
            }
            .btn {
              width: 100%;
              background: #3b82f6;
              color: white;
              padding: 12px;
              border: none;
              border-radius: 5px;
              cursor: pointer;
              font-size: 16px;
            }
            .btn:hover { background: #2563eb; }
            .error {
              color: #ef4444;
              margin-top: 10px;
              display: none;
            }
          </style>
        </head>
        <body>
          <div class="login-container">
            <h1>🤖 RoccoBots</h1>
            <form onsubmit="handleLogin(event)">
              <div class="form-group">
                <label for="password">Admin Password</label>
                <input type="password" id="password" name="password" required autofocus>
              </div>
              <button type="submit" class="btn">Login</button>
              <div class="error" id="error"></div>
            </form>
          </div>

          <script>
            async function handleLogin(e) {
              e.preventDefault();
              const password = document.getElementById('password').value;
              const errorEl = document.getElementById('error');

              const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
              });

              const data = await res.json();

              if (data.success) {
                window.location = '/';
              } else {
                errorEl.textContent = data.error || 'Login failed';
                errorEl.style.display = 'block';
              }
            }
          </script>
        </body>
      </html>
    `);
  });

  app.get("/bots/new", requireAuth, async (c) => {
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Add Bot - RoccoBots</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background: #0f172a;
              color: #e2e8f0;
            }
            h1 { color: #60a5fa; }
            .form-group {
              margin-bottom: 20px;
            }
            label {
              display: block;
              margin-bottom: 5px;
              font-weight: 500;
            }
            input[type="text"],
            input[type="password"],
            input[type="number"] {
              width: 100%;
              padding: 10px;
              border: 1px solid #334155;
              border-radius: 5px;
              background: #1e293b;
              color: #e2e8f0;
              box-sizing: border-box;
            }
            .checkbox-group {
              display: flex;
              align-items: center;
              gap: 10px;
            }
            .btn {
              background: #3b82f6;
              color: white;
              padding: 10px 20px;
              border: none;
              border-radius: 5px;
              cursor: pointer;
              margin-right: 10px;
            }
            .btn:hover { background: #2563eb; }
            .btn-secondary {
              background: #6b7280;
            }
            .btn-secondary:hover { background: #4b5563; }
          </style>
        </head>
        <body>
          <h1>Add New Bot</h1>
          <form onsubmit="handleSubmit(event)">
            <div class="form-group">
              <label for="twitterHandle">Twitter Handle (without @)</label>
              <input type="text" id="twitterHandle" required>
            </div>

            <div class="form-group">
              <label for="twitterUsername">Twitter Username (email)</label>
              <input type="text" id="twitterUsername" required>
            </div>

            <div class="form-group">
              <label for="twitterPassword">Twitter Password</label>
              <input type="password" id="twitterPassword" required>
            </div>

            <div class="form-group">
              <label for="syncFrequencyMin">Sync Frequency (minutes)</label>
              <input type="number" id="syncFrequencyMin" value="30" min="1" required>
            </div>

            <div class="form-group checkbox-group">
              <input type="checkbox" id="syncPosts" checked>
              <label for="syncPosts">Sync Posts</label>
            </div>

            <div class="form-group checkbox-group">
              <input type="checkbox" id="syncProfileDescription" checked>
              <label for="syncProfileDescription">Sync Profile Description</label>
            </div>

            <div class="form-group checkbox-group">
              <input type="checkbox" id="syncProfilePicture" checked>
              <label for="syncProfilePicture">Sync Profile Picture</label>
            </div>

            <div class="form-group checkbox-group">
              <input type="checkbox" id="enabled" checked>
              <label for="enabled">Enabled</label>
            </div>

            <button type="submit" class="btn">Create Bot</button>
            <a href="/" class="btn btn-secondary">Cancel</a>
          </form>

          <script>
            async function handleSubmit(e) {
              e.preventDefault();

              const data = {
                twitterHandle: document.getElementById('twitterHandle').value,
                twitterUsername: document.getElementById('twitterUsername').value,
                twitterPassword: document.getElementById('twitterPassword').value,
                syncFrequencyMin: parseInt(document.getElementById('syncFrequencyMin').value),
                syncPosts: document.getElementById('syncPosts').checked,
                syncProfileDescription: document.getElementById('syncProfileDescription').checked,
                syncProfilePicture: document.getElementById('syncProfilePicture').checked,
                enabled: document.getElementById('enabled').checked,
              };

              const res = await fetch('/api/bots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
              });

              if (res.ok) {
                alert('Bot created successfully!');
                window.location = '/';
              } else {
                const error = await res.json();
                alert('Error: ' + error.error);
              }
            }
          </script>
        </body>
      </html>
    `);
  });

  return { app, botManager, configService, port };
}
