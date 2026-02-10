import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { DBType } from "db";
import { Scraper as XClient } from "@the-convocation/twitter-scraper";
import { sessionMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error";
import { BotManager } from "./services/bot-manager";
import { ConfigService } from "./services/config-service";
import authRouter from "./routes/api/auth";
import botsRouter from "./routes/api/bots";
import platformsRouter from "./routes/api/platforms";
import systemRouter from "./routes/api/system";
import eventsRouter from "./routes/api/events";
import {
  importFromEnv,
  importFromEnvContent,
} from "./services/config-migration";
import { requireAuth } from "./middleware/auth";

export interface ServerOptions {
  db: DBType;
  xClient: XClient;
  port?: number;
}

/**
 * Create and configure the web server
 */
export function createServer(options: ServerOptions) {
  const { db, xClient, port = 3000 } = options;

  const app = new Hono();

  // Initialize services
  const botManager = new BotManager(db, xClient);
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

  // Import from uploaded .env file content
  app.post("/api/config/import-env-upload", requireAuth, async (c) => {
    try {
      const body = await c.req.json();
      const content = body.content;

      if (!content || typeof content !== "string") {
        return c.json(
          { success: false, error: "No .env content provided" },
          400,
        );
      }

      const result = await importFromEnvContent(configService, content);
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
            <button class="btn" onclick="importEnvFromServer()">📥 Import from server .env</button>
            <button class="btn" onclick="document.getElementById('envFileInput').click()">📤 Upload .env File</button>
            <input type="file" id="envFileInput" accept=".env,.txt" style="display:none" onchange="importEnvFromUpload(event)">
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
                    <a href="/bots/\${bot.id}/logs" class="btn">Logs</a>
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

            async function importEnvFromServer() {
              if (!confirm('Import bots from the server-side .env file?')) return;
              const res = await fetch('/api/config/import-env', { method: 'POST' });
              const data = await res.json();
              if (data.success) {
                alert('Imported ' + data.created + ' bots.' + (data.errors.length ? '\\nErrors: ' + data.errors.join('\\n') : ''));
              } else {
                alert('Import failed: ' + data.error);
              }
              loadBots();
            }

            async function importEnvFromUpload(event) {
              const file = event.target.files[0];
              if (!file) return;
              const content = await file.text();
              const res = await fetch('/api/config/import-env-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
              });
              const data = await res.json();
              if (data.success) {
                alert('Imported ' + data.created + ' bots.' + (data.errors.length ? '\\nErrors: ' + data.errors.join('\\n') : ''));
              } else {
                alert('Import failed: ' + data.error);
              }
              event.target.value = '';
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
            h1, h2 { color: #60a5fa; }
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
              text-decoration: none;
              display: inline-block;
            }
            .btn:hover { background: #2563eb; }
            .btn-secondary {
              background: #6b7280;
            }
            .btn-secondary:hover { background: #4b5563; }
            .platform-section {
              background: #1e293b;
              border: 1px solid #334155;
              border-radius: 8px;
              padding: 15px;
              margin-bottom: 15px;
            }
            .platform-section summary {
              cursor: pointer;
              font-weight: 500;
              font-size: 16px;
              list-style: none;
            }
            .platform-section summary::-webkit-details-marker { display: none; }
            .platform-section summary label {
              display: inline;
              cursor: pointer;
            }
            .platform-fields {
              margin-top: 15px;
              padding-left: 15px;
              border-left: 2px solid #3b82f6;
            }
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

            <h2 style="margin-top: 30px;">Platform Credentials</h2>
            <p style="color: #94a3b8; font-size: 14px; margin-bottom: 15px;">Configure target platforms to sync to. You can also add these later from the edit page.</p>

            <details class="platform-section" id="blueskySection">
              <summary>
                <input type="checkbox" id="blueskyEnabled" onclick="event.stopPropagation(); this.closest('details').open = this.checked;">
                <label for="blueskyEnabled">Bluesky</label>
              </summary>
              <div class="platform-fields">
                <div class="form-group">
                  <label for="blueskyIdentifier">Bluesky Identifier (handle or email)</label>
                  <input type="text" id="blueskyIdentifier" placeholder="user.bsky.social">
                </div>
                <div class="form-group">
                  <label for="blueskyPassword">Bluesky App Password</label>
                  <input type="password" id="blueskyPassword">
                </div>
                <div class="form-group">
                  <label for="blueskyInstance">Bluesky Instance (optional)</label>
                  <input type="text" id="blueskyInstance" placeholder="bsky.social" value="bsky.social">
                </div>
              </div>
            </details>

            <details class="platform-section" id="mastodonSection">
              <summary>
                <input type="checkbox" id="mastodonEnabled" onclick="event.stopPropagation(); this.closest('details').open = this.checked;">
                <label for="mastodonEnabled">Mastodon</label>
              </summary>
              <div class="platform-fields">
                <div class="form-group">
                  <label for="mastodonInstance">Mastodon Instance URL</label>
                  <input type="text" id="mastodonInstance" placeholder="https://mastodon.social">
                </div>
                <div class="form-group">
                  <label for="mastodonToken">Mastodon Access Token</label>
                  <input type="password" id="mastodonToken">
                </div>
              </div>
            </details>

            <details class="platform-section" id="misskeySection">
              <summary>
                <input type="checkbox" id="misskeyEnabled" onclick="event.stopPropagation(); this.closest('details').open = this.checked;">
                <label for="misskeyEnabled">Misskey</label>
              </summary>
              <div class="platform-fields">
                <div class="form-group">
                  <label for="misskeyInstance">Misskey Instance URL</label>
                  <input type="text" id="misskeyInstance" placeholder="https://misskey.io">
                </div>
                <div class="form-group">
                  <label for="misskeyToken">Misskey Access Token</label>
                  <input type="password" id="misskeyToken">
                </div>
              </div>
            </details>

            <details class="platform-section" id="discordSection">
              <summary>
                <input type="checkbox" id="discordEnabled" onclick="event.stopPropagation(); this.closest('details').open = this.checked;">
                <label for="discordEnabled">Discord</label>
              </summary>
              <div class="platform-fields">
                <div class="form-group">
                  <label for="discordWebhook">Discord Webhook URL</label>
                  <input type="text" id="discordWebhook" placeholder="https://discord.com/api/webhooks/...">
                </div>
              </div>
            </details>

            <div style="margin-top: 20px;">
              <button type="submit" class="btn">Create Bot</button>
              <a href="/" class="btn btn-secondary">Cancel</a>
            </div>
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

              if (!res.ok) {
                const error = await res.json();
                alert('Error creating bot: ' + error.error);
                return;
              }

              const { bot } = await res.json();
              const platformErrors = [];

              const platforms = [
                {
                  id: 'bluesky',
                  enabled: document.getElementById('blueskyEnabled').checked,
                  getCredentials: function() {
                    return {
                      BLUESKY_IDENTIFIER: document.getElementById('blueskyIdentifier').value,
                      BLUESKY_PASSWORD: document.getElementById('blueskyPassword').value,
                      BLUESKY_INSTANCE: document.getElementById('blueskyInstance').value || 'bsky.social',
                    };
                  },
                  validate: function() {
                    return document.getElementById('blueskyIdentifier').value && document.getElementById('blueskyPassword').value;
                  },
                },
                {
                  id: 'mastodon',
                  enabled: document.getElementById('mastodonEnabled').checked,
                  getCredentials: function() {
                    return {
                      MASTODON_INSTANCE: document.getElementById('mastodonInstance').value,
                      MASTODON_TOKEN: document.getElementById('mastodonToken').value,
                    };
                  },
                  validate: function() {
                    return document.getElementById('mastodonInstance').value && document.getElementById('mastodonToken').value;
                  },
                },
                {
                  id: 'misskey',
                  enabled: document.getElementById('misskeyEnabled').checked,
                  getCredentials: function() {
                    return {
                      MISSKEY_INSTANCE: document.getElementById('misskeyInstance').value,
                      MISSKEY_TOKEN: document.getElementById('misskeyToken').value,
                    };
                  },
                  validate: function() {
                    return document.getElementById('misskeyInstance').value && document.getElementById('misskeyToken').value;
                  },
                },
                {
                  id: 'discord',
                  enabled: document.getElementById('discordEnabled').checked,
                  getCredentials: function() {
                    return {
                      DISCORD_WEBHOOK: document.getElementById('discordWebhook').value,
                    };
                  },
                  validate: function() {
                    return document.getElementById('discordWebhook').value;
                  },
                },
              ];

              for (const p of platforms) {
                if (!p.enabled) continue;
                if (!p.validate()) {
                  platformErrors.push(p.id + ': missing required fields');
                  continue;
                }
                try {
                  const pRes = await fetch('/api/' + bot.id + '/platforms', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      platformId: p.id,
                      enabled: true,
                      credentials: p.getCredentials(),
                    }),
                  });
                  if (!pRes.ok) {
                    const pErr = await pRes.json();
                    platformErrors.push(p.id + ': ' + pErr.error);
                  }
                } catch (err) {
                  platformErrors.push(p.id + ': ' + err.message);
                }
              }

              if (platformErrors.length > 0) {
                alert('Bot created but some platforms failed:\\n' + platformErrors.join('\\n'));
              }
              window.location = '/';
            }
          </script>
        </body>
      </html>
    `);
  });

  // Bot edit page
  app.get("/bots/:id", requireAuth, async (c) => {
    const id = c.req.param("id");

    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Edit Bot - RoccoBots</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background: #0f172a;
              color: #e2e8f0;
            }
            h1, h2 { color: #60a5fa; }
            .form-group { margin-bottom: 20px; }
            label { display: block; margin-bottom: 5px; font-weight: 500; }
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
            .checkbox-group { display: flex; align-items: center; gap: 10px; }
            .btn {
              background: #3b82f6;
              color: white;
              padding: 10px 20px;
              border: none;
              border-radius: 5px;
              cursor: pointer;
              margin-right: 10px;
              text-decoration: none;
              display: inline-block;
            }
            .btn:hover { background: #2563eb; }
            .btn-secondary { background: #6b7280; }
            .btn-secondary:hover { background: #4b5563; }
            .platform-section {
              background: #1e293b;
              border: 1px solid #334155;
              border-radius: 8px;
              padding: 15px;
              margin-bottom: 15px;
            }
            .platform-section summary {
              cursor: pointer;
              font-weight: 500;
              font-size: 16px;
              list-style: none;
            }
            .platform-section summary::-webkit-details-marker { display: none; }
            .platform-section summary label { display: inline; cursor: pointer; }
            .platform-fields {
              margin-top: 15px;
              padding-left: 15px;
              border-left: 2px solid #3b82f6;
            }
            .hint { color: #94a3b8; font-size: 12px; margin-top: 4px; }
            #loading { text-align: center; padding: 40px; color: #94a3b8; }
            #editForm { display: none; }
          </style>
        </head>
        <body>
          <h1 id="pageTitle">Edit Bot</h1>
          <div id="loading">Loading bot configuration...</div>
          <form id="editForm" onsubmit="handleSubmit(event)">
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
              <input type="password" id="twitterPassword" placeholder="Leave blank to keep current">
              <div class="hint">Only fill in if you want to change the password</div>
            </div>

            <div class="form-group">
              <label for="syncFrequencyMin">Sync Frequency (minutes)</label>
              <input type="number" id="syncFrequencyMin" value="30" min="1" required>
            </div>

            <div class="form-group checkbox-group">
              <input type="checkbox" id="syncPosts">
              <label for="syncPosts">Sync Posts</label>
            </div>

            <div class="form-group checkbox-group">
              <input type="checkbox" id="syncProfileDescription">
              <label for="syncProfileDescription">Sync Profile Description</label>
            </div>

            <div class="form-group checkbox-group">
              <input type="checkbox" id="syncProfilePicture">
              <label for="syncProfilePicture">Sync Profile Picture</label>
            </div>

            <div class="form-group checkbox-group">
              <input type="checkbox" id="enabled">
              <label for="enabled">Enabled</label>
            </div>

            <h2 style="margin-top: 30px;">Platform Credentials</h2>
            <p style="color: #94a3b8; font-size: 14px; margin-bottom: 15px;">Configure target platforms. Leave password/token fields blank to keep existing credentials.</p>

            <details class="platform-section" id="blueskySection">
              <summary>
                <input type="checkbox" id="blueskyEnabled" onclick="event.stopPropagation(); this.closest('details').open = this.checked;">
                <label for="blueskyEnabled">Bluesky</label>
              </summary>
              <div class="platform-fields">
                <div class="form-group">
                  <label for="blueskyIdentifier">Bluesky Identifier (handle or email)</label>
                  <input type="text" id="blueskyIdentifier" placeholder="user.bsky.social">
                </div>
                <div class="form-group">
                  <label for="blueskyPassword">Bluesky App Password</label>
                  <input type="password" id="blueskyPassword" placeholder="Leave blank to keep current">
                </div>
                <div class="form-group">
                  <label for="blueskyInstance">Bluesky Instance</label>
                  <input type="text" id="blueskyInstance" placeholder="bsky.social" value="bsky.social">
                </div>
              </div>
            </details>

            <details class="platform-section" id="mastodonSection">
              <summary>
                <input type="checkbox" id="mastodonEnabled" onclick="event.stopPropagation(); this.closest('details').open = this.checked;">
                <label for="mastodonEnabled">Mastodon</label>
              </summary>
              <div class="platform-fields">
                <div class="form-group">
                  <label for="mastodonInstance">Mastodon Instance URL</label>
                  <input type="text" id="mastodonInstance" placeholder="https://mastodon.social">
                </div>
                <div class="form-group">
                  <label for="mastodonToken">Mastodon Access Token</label>
                  <input type="password" id="mastodonToken" placeholder="Leave blank to keep current">
                </div>
              </div>
            </details>

            <details class="platform-section" id="misskeySection">
              <summary>
                <input type="checkbox" id="misskeyEnabled" onclick="event.stopPropagation(); this.closest('details').open = this.checked;">
                <label for="misskeyEnabled">Misskey</label>
              </summary>
              <div class="platform-fields">
                <div class="form-group">
                  <label for="misskeyInstance">Misskey Instance URL</label>
                  <input type="text" id="misskeyInstance" placeholder="https://misskey.io">
                </div>
                <div class="form-group">
                  <label for="misskeyToken">Misskey Access Token</label>
                  <input type="password" id="misskeyToken" placeholder="Leave blank to keep current">
                </div>
              </div>
            </details>

            <details class="platform-section" id="discordSection">
              <summary>
                <input type="checkbox" id="discordEnabled" onclick="event.stopPropagation(); this.closest('details').open = this.checked;">
                <label for="discordEnabled">Discord</label>
              </summary>
              <div class="platform-fields">
                <div class="form-group">
                  <label for="discordWebhook">Discord Webhook URL</label>
                  <input type="text" id="discordWebhook" placeholder="https://discord.com/api/webhooks/...">
                </div>
              </div>
            </details>

            <div style="margin-top: 20px;">
              <button type="submit" class="btn">Save Changes</button>
              <a href="/" class="btn btn-secondary">Cancel</a>
            </div>
          </form>

          <script>
            const BOT_ID = ${id};
            let existingPlatforms = {};

            async function loadBot() {
              try {
                const res = await fetch('/api/bots/' + BOT_ID);
                if (!res.ok) { alert('Bot not found'); window.location = '/'; return; }
                const data = await res.json();
                const bot = data.bot;

                document.getElementById('pageTitle').textContent = 'Edit Bot: @' + bot.twitterHandle;
                document.getElementById('twitterHandle').value = bot.twitterHandle;
                document.getElementById('twitterUsername').value = bot.twitterUsername;
                document.getElementById('syncFrequencyMin').value = bot.syncFrequencyMin;
                document.getElementById('syncPosts').checked = bot.syncPosts;
                document.getElementById('syncProfileDescription').checked = bot.syncProfileDescription;
                document.getElementById('syncProfilePicture').checked = bot.syncProfilePicture;
                document.getElementById('enabled').checked = bot.enabled;

                // Load platforms
                if (bot.platforms) {
                  for (const p of bot.platforms) {
                    existingPlatforms[p.platformId] = p;
                    if (p.platformId === 'bluesky') {
                      document.getElementById('blueskyEnabled').checked = true;
                      document.getElementById('blueskySection').open = true;
                      if (p.credentials) {
                        document.getElementById('blueskyIdentifier').value = p.credentials.BLUESKY_IDENTIFIER || '';
                        document.getElementById('blueskyInstance').value = p.credentials.BLUESKY_INSTANCE || 'bsky.social';
                      }
                    } else if (p.platformId === 'mastodon') {
                      document.getElementById('mastodonEnabled').checked = true;
                      document.getElementById('mastodonSection').open = true;
                      if (p.credentials) {
                        document.getElementById('mastodonInstance').value = p.credentials.MASTODON_INSTANCE || '';
                      }
                    } else if (p.platformId === 'misskey') {
                      document.getElementById('misskeyEnabled').checked = true;
                      document.getElementById('misskeySection').open = true;
                      if (p.credentials) {
                        document.getElementById('misskeyInstance').value = p.credentials.MISSKEY_INSTANCE || '';
                      }
                    } else if (p.platformId === 'discord') {
                      document.getElementById('discordEnabled').checked = true;
                      document.getElementById('discordSection').open = true;
                      if (p.credentials) {
                        document.getElementById('discordWebhook').value = p.credentials.DISCORD_WEBHOOK || '';
                      }
                    }
                  }
                }

                document.getElementById('loading').style.display = 'none';
                document.getElementById('editForm').style.display = 'block';
              } catch (err) {
                alert('Failed to load bot: ' + err.message);
              }
            }

            async function handleSubmit(e) {
              e.preventDefault();

              const botData = {
                twitterHandle: document.getElementById('twitterHandle').value,
                twitterUsername: document.getElementById('twitterUsername').value,
                syncFrequencyMin: parseInt(document.getElementById('syncFrequencyMin').value),
                syncPosts: document.getElementById('syncPosts').checked,
                syncProfileDescription: document.getElementById('syncProfileDescription').checked,
                syncProfilePicture: document.getElementById('syncProfilePicture').checked,
                enabled: document.getElementById('enabled').checked,
              };

              // Only include password if changed
              const pw = document.getElementById('twitterPassword').value;
              if (pw) botData.twitterPassword = pw;

              const res = await fetch('/api/bots/' + BOT_ID, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(botData),
              });

              if (!res.ok) {
                const error = await res.json();
                alert('Error updating bot: ' + error.error);
                return;
              }

              const platformErrors = [];

              // Platform definitions
              const platforms = [
                {
                  id: 'bluesky',
                  enabled: document.getElementById('blueskyEnabled').checked,
                  getCredentials: function() {
                    const creds = {
                      BLUESKY_IDENTIFIER: document.getElementById('blueskyIdentifier').value,
                      BLUESKY_INSTANCE: document.getElementById('blueskyInstance').value || 'bsky.social',
                    };
                    const pw = document.getElementById('blueskyPassword').value;
                    if (pw) creds.BLUESKY_PASSWORD = pw;
                    else if (existingPlatforms.bluesky && existingPlatforms.bluesky.credentials) {
                      creds.BLUESKY_PASSWORD = existingPlatforms.bluesky.credentials.BLUESKY_PASSWORD;
                    }
                    return creds;
                  },
                  validateNew: function() {
                    return document.getElementById('blueskyIdentifier').value && document.getElementById('blueskyPassword').value;
                  },
                  validateUpdate: function() {
                    return document.getElementById('blueskyIdentifier').value;
                  },
                },
                {
                  id: 'mastodon',
                  enabled: document.getElementById('mastodonEnabled').checked,
                  getCredentials: function() {
                    const creds = {
                      MASTODON_INSTANCE: document.getElementById('mastodonInstance').value,
                    };
                    const token = document.getElementById('mastodonToken').value;
                    if (token) creds.MASTODON_TOKEN = token;
                    else if (existingPlatforms.mastodon && existingPlatforms.mastodon.credentials) {
                      creds.MASTODON_TOKEN = existingPlatforms.mastodon.credentials.MASTODON_TOKEN;
                    }
                    return creds;
                  },
                  validateNew: function() {
                    return document.getElementById('mastodonInstance').value && document.getElementById('mastodonToken').value;
                  },
                  validateUpdate: function() {
                    return document.getElementById('mastodonInstance').value;
                  },
                },
                {
                  id: 'misskey',
                  enabled: document.getElementById('misskeyEnabled').checked,
                  getCredentials: function() {
                    const creds = {
                      MISSKEY_INSTANCE: document.getElementById('misskeyInstance').value,
                    };
                    const token = document.getElementById('misskeyToken').value;
                    if (token) creds.MISSKEY_TOKEN = token;
                    else if (existingPlatforms.misskey && existingPlatforms.misskey.credentials) {
                      creds.MISSKEY_TOKEN = existingPlatforms.misskey.credentials.MISSKEY_TOKEN;
                    }
                    return creds;
                  },
                  validateNew: function() {
                    return document.getElementById('misskeyInstance').value && document.getElementById('misskeyToken').value;
                  },
                  validateUpdate: function() {
                    return document.getElementById('misskeyInstance').value;
                  },
                },
                {
                  id: 'discord',
                  enabled: document.getElementById('discordEnabled').checked,
                  getCredentials: function() {
                    const webhook = document.getElementById('discordWebhook').value;
                    if (webhook) return { DISCORD_WEBHOOK: webhook };
                    if (existingPlatforms.discord && existingPlatforms.discord.credentials) {
                      return { DISCORD_WEBHOOK: existingPlatforms.discord.credentials.DISCORD_WEBHOOK };
                    }
                    return { DISCORD_WEBHOOK: '' };
                  },
                  validateNew: function() {
                    return document.getElementById('discordWebhook').value;
                  },
                  validateUpdate: function() { return true; },
                },
              ];

              for (const p of platforms) {
                const existed = !!existingPlatforms[p.id];

                if (p.enabled && !existed) {
                  // Create new platform
                  if (!p.validateNew()) {
                    platformErrors.push(p.id + ': missing required fields for new platform');
                    continue;
                  }
                  try {
                    const pRes = await fetch('/api/' + BOT_ID + '/platforms', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        platformId: p.id,
                        enabled: true,
                        credentials: p.getCredentials(),
                      }),
                    });
                    if (!pRes.ok) {
                      const pErr = await pRes.json();
                      platformErrors.push(p.id + ': ' + pErr.error);
                    }
                  } catch (err) {
                    platformErrors.push(p.id + ': ' + err.message);
                  }
                } else if (p.enabled && existed) {
                  // Update existing platform
                  if (!p.validateUpdate()) {
                    platformErrors.push(p.id + ': missing required fields');
                    continue;
                  }
                  try {
                    const pRes = await fetch('/api/' + BOT_ID + '/platforms/' + p.id, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        enabled: true,
                        credentials: p.getCredentials(),
                      }),
                    });
                    if (!pRes.ok) {
                      const pErr = await pRes.json();
                      platformErrors.push(p.id + ': ' + pErr.error);
                    }
                  } catch (err) {
                    platformErrors.push(p.id + ': ' + err.message);
                  }
                } else if (!p.enabled && existed) {
                  // Delete platform
                  try {
                    await fetch('/api/' + BOT_ID + '/platforms/' + p.id, { method: 'DELETE' });
                  } catch (err) {
                    platformErrors.push(p.id + ': failed to remove');
                  }
                }
              }

              if (platformErrors.length > 0) {
                alert('Bot saved but some platforms had issues:\\n' + platformErrors.join('\\n'));
              }
              window.location = '/';
            }

            loadBot();
          </script>
        </body>
      </html>
    `);
  });

  // Per-bot log viewer page
  app.get("/bots/:id/logs", requireAuth, async (c) => {
    const id = c.req.param("id");
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bot Logs - RoccoBots</title>
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
            .log-controls {
              display: flex;
              gap: 10px;
              margin-bottom: 15px;
              align-items: center;
              flex-wrap: wrap;
            }
            .log-container {
              background: #1e293b;
              border: 1px solid #334155;
              border-radius: 8px;
              padding: 15px;
              max-height: 600px;
              overflow-y: auto;
              font-family: 'SF Mono', Monaco, 'Cascadia Mono', 'Consolas', monospace;
              font-size: 13px;
              line-height: 1.6;
            }
            .log-entry {
              padding: 4px 8px;
              border-bottom: 1px solid #0f172a;
              display: flex;
              gap: 10px;
            }
            .log-entry:hover { background: #334155; }
            .log-time { color: #64748b; white-space: nowrap; min-width: 170px; }
            .log-level { font-weight: bold; min-width: 60px; text-transform: uppercase; font-size: 11px; }
            .log-level.info { color: #60a5fa; }
            .log-level.warn { color: #fbbf24; }
            .log-level.error { color: #ef4444; }
            .log-level.success { color: #10b981; }
            .log-platform { color: #a78bfa; min-width: 80px; }
            .log-message { flex: 1; word-break: break-word; }
            .live-dot {
              display: inline-block;
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background: #6b7280;
              margin-right: 5px;
              vertical-align: middle;
            }
            .live-dot.connected {
              background: #10b981;
              animation: pulse 2s infinite;
            }
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.3; }
            }
            .filter-select {
              background: #1e293b;
              color: #e2e8f0;
              border: 1px solid #334155;
              padding: 8px;
              border-radius: 5px;
            }
            .empty-state {
              text-align: center;
              padding: 40px;
              color: #64748b;
            }
          </style>
        </head>
        <body>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h1 id="pageTitle">Bot Logs</h1>
            <a href="/" class="btn">Back to Dashboard</a>
          </div>

          <div class="log-controls">
            <span><span class="live-dot" id="liveDot"></span><span id="liveStatus">Connecting...</span></span>
            <select class="filter-select" id="levelFilter" onchange="renderLogs()">
              <option value="">All levels</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
              <option value="success">Success</option>
            </select>
            <select class="filter-select" id="platformFilter" onchange="renderLogs()">
              <option value="">All platforms</option>
              <option value="bluesky">Bluesky</option>
              <option value="mastodon">Mastodon</option>
              <option value="misskey">Misskey</option>
              <option value="discord">Discord</option>
            </select>
            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
              <input type="checkbox" id="autoScroll" checked> Auto-scroll
            </label>
          </div>

          <div class="log-container" id="logContainer">
            <div class="empty-state">Loading logs...</div>
          </div>

          <div style="margin-top: 10px; text-align: center;">
            <button class="btn" id="loadMoreBtn" onclick="loadMore()" style="display: none;">Load Older Logs</button>
          </div>

          <script>
            const BOT_ID = parseInt('${id}');
            let allLogs = [];
            let offset = 0;
            const LIMIT = 100;
            let hasMore = true;

            function escapeHtml(text) {
              const div = document.createElement('div');
              div.textContent = text;
              return div.innerHTML;
            }

            async function loadBotInfo() {
              try {
                const res = await fetch('/api/bots/' + BOT_ID);
                if (res.ok) {
                  const data = await res.json();
                  document.getElementById('pageTitle').textContent = 'Logs: @' + data.bot.twitterHandle;
                }
              } catch (e) {}
            }

            async function loadLogs(prepend) {
              try {
                const res = await fetch('/api/bots/' + BOT_ID + '/logs?limit=' + LIMIT + '&offset=' + offset);
                const data = await res.json();

                if (data.logs.length < LIMIT) {
                  hasMore = false;
                  document.getElementById('loadMoreBtn').style.display = 'none';
                } else {
                  document.getElementById('loadMoreBtn').style.display = 'inline-block';
                }

                // API returns newest-first, reverse to show oldest-first
                const reversed = data.logs.reverse();

                if (prepend) {
                  allLogs = reversed.concat(allLogs);
                } else {
                  allLogs = reversed;
                }

                renderLogs();
              } catch (err) {
                document.getElementById('logContainer').innerHTML = '<div class="empty-state">Failed to load logs</div>';
              }
            }

            function loadMore() {
              offset += LIMIT;
              loadLogs(true);
            }

            function renderLogs() {
              const container = document.getElementById('logContainer');
              const levelFilter = document.getElementById('levelFilter').value;
              const platformFilter = document.getElementById('platformFilter').value;

              const filtered = allLogs.filter(function(log) {
                if (levelFilter && log.level !== levelFilter) return false;
                if (platformFilter && log.platform !== platformFilter) return false;
                return true;
              });

              if (filtered.length === 0) {
                container.innerHTML = '<div class="empty-state">No logs to display</div>';
                return;
              }

              container.innerHTML = filtered.map(function(log) {
                const time = new Date(log.timestamp).toLocaleString();
                const platform = log.platform || '';
                return '<div class="log-entry">' +
                  '<span class="log-time">' + escapeHtml(time) + '</span>' +
                  '<span class="log-level ' + log.level + '">' + log.level + '</span>' +
                  '<span class="log-platform">' + escapeHtml(platform) + '</span>' +
                  '<span class="log-message">' + escapeHtml(log.message) + '</span>' +
                '</div>';
              }).join('');

              if (document.getElementById('autoScroll').checked) {
                container.scrollTop = container.scrollHeight;
              }
            }

            function connectSSE() {
              var eventSource = new EventSource('/api/events');

              eventSource.addEventListener('connected', function() {
                document.getElementById('liveStatus').textContent = 'Live';
                document.getElementById('liveDot').className = 'live-dot connected';
              });

              eventSource.addEventListener('log', function(e) {
                var data = JSON.parse(e.data);
                if (data.botId === BOT_ID) {
                  allLogs.push({
                    level: data.level,
                    message: data.message,
                    platform: data.platform || null,
                    tweetId: data.tweetId || null,
                    timestamp: data.timestamp,
                  });
                  renderLogs();
                }
              });

              eventSource.onerror = function() {
                document.getElementById('liveStatus').textContent = 'Disconnected - reconnecting...';
                document.getElementById('liveDot').className = 'live-dot';
              };
            }

            loadBotInfo();
            loadLogs(false);
            connectSSE();
          </script>
        </body>
      </html>
    `);
  });

  return { app, botManager, configService, port };
}
