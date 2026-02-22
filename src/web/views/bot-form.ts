import {
  PLATFORM_DEFS,
  PLATFORM_IDS,
  renderPlatformForm,
} from "./components/platform-fields";
import { layout } from "./layout";

interface BotData {
  id?: number;
  twitterHandle?: string;
  syncFrequencyMin?: number;
  syncPosts?: boolean;
  syncProfileDescription?: boolean;
  syncProfilePicture?: boolean;
  syncProfileName?: boolean;
  syncProfileHeader?: boolean;
  backdateBlueskyPosts?: boolean;
  enabled?: boolean;
  platforms?: {
    platformId: string;
    enabled: boolean;
    credentials: Record<string, string>;
  }[];
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function checkbox(
  id: string,
  label: string,
  checked: boolean,
  name?: string,
): string {
  return `
    <label class="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" id="${id}" name="${name || id}" ${checked ? "checked" : ""}
        class="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0">
      <span class="text-sm text-slate-300">${label}</span>
    </label>`;
}

export function botFormPage(bot?: BotData): string {
  const isEdit = !!bot?.id;
  const title = isEdit ? `Edit @${bot!.twitterHandle}` : "Add Bot";

  const configuredPlatformIds = (bot?.platforms || []).map((p) => p.platformId);
  const availablePlatforms = PLATFORM_IDS.filter(
    (id) => !configuredPlatformIds.includes(id),
  );

  // Render existing platform forms
  const existingPlatformForms = (bot?.platforms || [])
    .map((p) =>
      renderPlatformForm(p.platformId, p.credentials, { existing: true }),
    )
    .join("");

  // Build available platforms JSON for client-side dropdown
  const platformDefsJSON = JSON.stringify(PLATFORM_DEFS);

  return layout({
    title,
    authenticated: true,
    content: `
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <a href="${isEdit ? `/bots/${bot!.id}` : "/"}" class="text-slate-400 hover:text-slate-200 transition-colors">&larr;</a>
        <h1 class="text-xl font-bold text-slate-100">${title}</h1>
      </div>

      <form id="bot-form" onsubmit="handleSubmit(event)">
        <!-- Bot Configuration -->
        <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-6">
          <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">Source Account</h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm text-slate-400 mb-1">Source Handle (without @)</label>
              <input type="text" id="twitterHandle" value="${escapeAttr(bot?.twitterHandle || "")}" ${isEdit ? "readonly" : "required"}
                class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 ${isEdit ? "opacity-60 cursor-not-allowed" : ""}"
                placeholder="username">
              <p class="text-xs text-slate-500 mt-1">The Twitter account to copy posts from. Twitter login credentials are configured in <a href="/settings" class="text-blue-400 hover:text-blue-300">Settings</a>.</p>
            </div>
            <div>
              <label class="block text-sm text-slate-400 mb-1">Sync Frequency (minutes)</label>
              <input type="number" id="syncFrequencyMin" value="${bot?.syncFrequencyMin ?? 30}" min="1" required
                class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500">
            </div>
          </div>
        </div>

        <!-- Sync Options -->
        <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-6">
          <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">Sync Options</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${checkbox("syncPosts", "Sync Posts", bot?.syncPosts ?? true)}
            ${checkbox("syncProfileDescription", "Sync Bio", bot?.syncProfileDescription ?? true)}
            ${checkbox("syncProfilePicture", "Sync Profile Picture", bot?.syncProfilePicture ?? true)}
            ${checkbox("syncProfileName", "Sync Display Name", bot?.syncProfileName ?? true)}
            ${checkbox("syncProfileHeader", "Sync Header Image", bot?.syncProfileHeader ?? true)}
            ${checkbox("backdateBlueskyPosts", "Backdate Bluesky Posts", bot?.backdateBlueskyPosts ?? true)}
            ${checkbox("enabled", "Enabled", bot?.enabled ?? true)}
          </div>
        </div>

        <!-- Platforms -->
        <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-6">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Platforms</h2>
            ${
              availablePlatforms.length > 0
                ? `
              <div class="relative">
                <select id="add-platform-select" onchange="addPlatform(this.value); this.value='';"
                  class="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500">
                  <option value="">Add platform...</option>
                  ${availablePlatforms.map((id) => `<option value="${id}">${PLATFORM_DEFS[id].displayName}</option>`).join("")}
                </select>
              </div>
            `
                : ""
            }
          </div>
          <div id="platforms-container" class="space-y-4">
            ${existingPlatformForms || '<p class="text-sm text-slate-500">No platforms configured. Add one above.</p>'}
          </div>
        </div>

        ${
          isEdit
            ? `
        <!-- Commands -->
        <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-6">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Bluesky Commands</h2>
          </div>
          <div id="commands-section">
            <div id="commands-no-bluesky" class="hidden">
              <p class="text-sm text-amber-400">Commands require a Bluesky platform to be configured.</p>
            </div>
            <div id="commands-form" class="space-y-4">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" id="commandsEnabled" class="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0">
                <span class="text-sm text-slate-300">Enable Bluesky Commands</span>
              </label>
              <div>
                <label class="block text-sm text-slate-400 mb-1">Trusted Handles (one per line, without @)</label>
                <textarea id="trustedHandles" rows="3" placeholder="user1.bsky.social&#10;user2.bsky.social"
                  class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"></textarea>
                <p class="text-xs text-slate-500 mt-1">Only these handles can issue commands. Leave empty to block all commands.</p>
              </div>
              <div>
                <label class="block text-sm text-slate-400 mb-1">Poll Interval (seconds)</label>
                <input type="number" id="commandsPollInterval" value="60" min="10"
                  class="w-32 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500">
              </div>
              <details class="group">
                <summary class="text-sm text-slate-400 cursor-pointer hover:text-slate-200 transition-colors">Response Messages (optional)</summary>
                <div class="mt-3 space-y-3 pl-2 border-l border-slate-700">
                  <div>
                    <label class="block text-xs text-slate-500 mb-1">Restart</label>
                    <input type="text" id="msgRestart" placeholder="Restarting bot..."
                      class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500">
                  </div>
                  <div>
                    <label class="block text-xs text-slate-500 mb-1">Sync</label>
                    <input type="text" id="msgSync" placeholder="Sync triggered!"
                      class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500">
                  </div>
                  <div>
                    <label class="block text-xs text-slate-500 mb-1">Source (use {handle} for current handle)</label>
                    <input type="text" id="msgSource" placeholder="Current source: @{handle}"
                      class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500">
                  </div>
                  <div>
                    <label class="block text-xs text-slate-500 mb-1">Source Changed (use {handle} for new handle)</label>
                    <input type="text" id="msgSourceChanged" placeholder="Source changed to @{handle}. Restarting..."
                      class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500">
                  </div>
                  <div>
                    <label class="block text-xs text-slate-500 mb-1">Unauthorized</label>
                    <input type="text" id="msgUnauthorized" placeholder="You are not authorized to use commands."
                      class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500">
                  </div>
                  <div>
                    <label class="block text-xs text-slate-500 mb-1">Error (use {error} for error message)</label>
                    <input type="text" id="msgError" placeholder="Command failed: {error}"
                      class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500">
                  </div>
                  <div>
                    <label class="block text-xs text-slate-500 mb-1">Unknown Command</label>
                    <input type="text" id="msgUnknown" placeholder="Unknown command. Available: !sync, !restart, !source, !status, !frequency, !posts, !bio, !avatar, !name, !header, !backdate, !help"
                      class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500">
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
        `
            : ""
        }

        <!-- Submit -->
        <div class="flex items-center gap-3">
          <button type="submit" id="submit-btn" class="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-6 py-2.5 rounded transition-colors">
            ${isEdit ? "Save Changes" : "Create Bot"}
          </button>
          <a href="/" class="text-sm text-slate-400 hover:text-slate-200 transition-colors">Cancel</a>
        </div>
      </form>

      ${
        isEdit
          ? `
      <!-- Recent Logs -->
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 mt-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Recent Logs</h2>
          <a href="/bots/${bot!.id}/logs" class="text-xs text-blue-400 hover:text-blue-300 transition-colors">View All</a>
        </div>
        <div id="recent-logs" class="space-y-1 max-h-64 overflow-y-auto text-xs">
          <div class="text-slate-500">Loading...</div>
        </div>
      </div>
      `
          : ""
      }
    </div>`,
    scripts: `
    <script>
      const isEdit = ${isEdit};
      const botId = ${bot?.id ?? "null"};
      const platformDefs = ${platformDefsJSON};

      function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
      }

      function togglePassword(btn) {
        const input = btn.previousElementSibling;
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = 'Hide';
        } else {
          input.type = 'password';
          btn.textContent = 'Show';
        }
      }

      function addPlatform(platformId) {
        if (!platformId) return;
        const def = platformDefs[platformId];
        if (!def) return;

        const container = document.getElementById('platforms-container');
        // Remove "no platforms" message if present
        const noMsg = container.querySelector('p');
        if (noMsg) noMsg.remove();

        const colorMap = { blue: 'border-blue-500/30 bg-blue-500/5', purple: 'border-purple-500/30 bg-purple-500/5', green: 'border-green-500/30 bg-green-500/5', indigo: 'border-indigo-500/30 bg-indigo-500/5' };
        const badgeMap = { blue: 'bg-blue-500/20 text-blue-400', purple: 'bg-purple-500/20 text-purple-400', green: 'bg-green-500/20 text-green-400', indigo: 'bg-indigo-500/20 text-indigo-400' };

        const borderColor = colorMap[def.color] || colorMap.blue;
        const badge = badgeMap[def.color] || badgeMap.blue;

        const fields = def.fields.map(f => {
          const val = f.defaultValue || '';
          const inputType = f.type === 'password' ? 'password' : 'text';
          return '<div>' +
            '<label class="block text-sm text-slate-400 mb-1">' + escapeHtml(f.label) + '</label>' +
            '<div class="flex gap-2">' +
              '<input type="' + inputType + '" name="' + f.key + '" value="' + escapeHtml(val) + '"' +
                ' placeholder="' + escapeHtml(f.placeholder) + '"' +
                ' class="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500">' +
              (f.type === 'password' ? '<button type="button" onclick="togglePassword(this)" class="text-xs text-slate-400 hover:text-slate-200 px-2">Show</button>' : '') +
            '</div></div>';
        }).join('');

        const html = '<div class="border rounded-lg p-4 ' + borderColor + '" data-platform="' + platformId + '">' +
          '<div class="flex items-center justify-between mb-3">' +
            '<span class="text-sm font-medium ' + badge + ' px-2 py-0.5 rounded">' + escapeHtml(def.displayName) + '</span>' +
            '<button type="button" onclick="removePlatform(\\'' + platformId + '\\')" class="text-xs text-red-400 hover:text-red-300">Remove</button>' +
          '</div>' +
          '<div class="space-y-3">' + fields + '</div>' +
        '</div>';

        container.insertAdjacentHTML('beforeend', html);

        // Remove from dropdown
        const select = document.getElementById('add-platform-select');
        if (select) {
          const opt = select.querySelector('option[value="' + platformId + '"]');
          if (opt) opt.remove();
        }
      }

      function removePlatform(platformId) {
        const el = document.querySelector('[data-platform="' + platformId + '"]');
        if (el) el.remove();

        // Re-add to dropdown
        const select = document.getElementById('add-platform-select');
        if (select && platformDefs[platformId]) {
          const opt = document.createElement('option');
          opt.value = platformId;
          opt.textContent = platformDefs[platformId].displayName;
          select.appendChild(opt);
        }

        // If editing, delete platform via API
        if (isEdit && botId) {
          fetch('/api/bots/' + botId + '/platforms/' + platformId, { method: 'DELETE' })
            .then(() => showToast('Platform removed', 'success'))
            .catch(() => showToast('Failed to remove platform', 'error'));
        }
      }

      function collectPlatforms() {
        const platforms = [];
        document.querySelectorAll('#platforms-container [data-platform]').forEach(el => {
          const platformId = el.dataset.platform;
          const credentials = {};
          el.querySelectorAll('input[name]').forEach(input => {
            if (input.value) credentials[input.name] = input.value;
          });
          if (Object.keys(credentials).length > 0) {
            platforms.push({ platformId, credentials, enabled: true });
          }
        });
        return platforms;
      }

      async function handleSubmit(e) {
        e.preventDefault();
        const btn = document.getElementById('submit-btn');
        btn.disabled = true;
        btn.textContent = isEdit ? 'Saving...' : 'Creating...';

        try {
          const body = {
            twitterHandle: document.getElementById('twitterHandle').value,
            syncFrequencyMin: parseInt(document.getElementById('syncFrequencyMin').value),
            syncPosts: document.getElementById('syncPosts').checked,
            syncProfileDescription: document.getElementById('syncProfileDescription').checked,
            syncProfilePicture: document.getElementById('syncProfilePicture').checked,
            syncProfileName: document.getElementById('syncProfileName').checked,
            syncProfileHeader: document.getElementById('syncProfileHeader').checked,
            backdateBlueskyPosts: document.getElementById('backdateBlueskyPosts').checked,
            enabled: document.getElementById('enabled').checked,
          };

          if (isEdit) {
            // Update bot
            const res = await fetch('/api/bots/' + botId, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Update failed'); }

            // Save platforms
            const platforms = collectPlatforms();
            const platformErrors = [];
            for (const p of platforms) {
              // Try update first, then create
              const updateRes = await fetch('/api/bots/' + botId + '/platforms/' + p.platformId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credentials: p.credentials, enabled: p.enabled }),
              });
              if (!updateRes.ok) {
                // Platform doesn't exist yet, create it
                const createRes = await fetch('/api/bots/' + botId + '/platforms', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(p),
                });
                if (!createRes.ok) {
                  const d = await createRes.json().catch(() => ({}));
                  platformErrors.push(p.platformId + ': ' + (d.error || 'save failed'));
                }
              }
            }

            // Save command config
            await saveCommandConfig();

            if (platformErrors.length > 0) {
              showToast('Bot saved but platform errors: ' + platformErrors.join(', '), 'error');
            } else {
              showToast('Changes saved', 'success');
            }
          } else {
            // Create bot
            const res = await fetch('/api/bots', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Create failed'); }
            const data = await res.json();
            const newBotId = data.bot?.id || data.id;

            // Save platforms for new bot
            if (newBotId) {
              const platforms = collectPlatforms();
              const platformErrors = [];
              for (const p of platforms) {
                const pRes = await fetch('/api/bots/' + newBotId + '/platforms', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(p),
                });
                if (!pRes.ok) {
                  const d = await pRes.json().catch(() => ({}));
                  platformErrors.push(p.platformId + ': ' + (d.error || 'save failed'));
                }
              }
              if (platformErrors.length > 0) {
                showToast('Bot created but platform errors: ' + platformErrors.join(', '), 'error');
              }
            }

            showToast('Bot created', 'success');
            window.location = '/';
            return;
          }
        } catch (err) {
          showToast(err.message || 'Something went wrong', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = isEdit ? 'Save Changes' : 'Create Bot';
        }
      }

      // Command config helpers
      function collectCommandConfig() {
        const el = document.getElementById('commandsEnabled');
        if (!el) return null;
        const enabled = el.checked;
        const handlesRaw = document.getElementById('trustedHandles')?.value || '';
        const trustedHandles = handlesRaw.split('\\n').map(h => h.trim().replace(/^@/, '')).filter(Boolean);
        const pollIntervalSec = parseInt(document.getElementById('commandsPollInterval')?.value) || 60;

        const responseMessages = {};
        const msgFields = {
          restart: 'msgRestart', sync: 'msgSync', source: 'msgSource',
          sourceChanged: 'msgSourceChanged', unauthorized: 'msgUnauthorized',
          error: 'msgError', unknown: 'msgUnknown'
        };
        for (const [key, id] of Object.entries(msgFields)) {
          const val = document.getElementById(id)?.value;
          if (val) responseMessages[key] = val;
        }

        return { enabled, trustedHandles, pollIntervalSec, responseMessages };
      }

      async function saveCommandConfig() {
        const cmdConfig = collectCommandConfig();
        if (!cmdConfig || !botId) return;
        try {
          await fetch('/api/bots/' + botId + '/commands', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cmdConfig),
          });
        } catch (err) {
          console.error('Failed to save command config:', err);
        }
      }

      async function loadCommandConfig() {
        if (!botId) return;
        // Check if bluesky platform exists
        const hasBsky = !!document.querySelector('[data-platform="bluesky"]');
        const noBskyEl = document.getElementById('commands-no-bluesky');
        const formEl = document.getElementById('commands-form');
        if (!hasBsky) {
          if (noBskyEl) noBskyEl.classList.remove('hidden');
          if (formEl) formEl.classList.add('hidden');
          return;
        }
        if (noBskyEl) noBskyEl.classList.add('hidden');
        if (formEl) formEl.classList.remove('hidden');

        try {
          const res = await fetch('/api/bots/' + botId + '/commands');
          const data = await res.json();
          const cfg = data.commands;
          if (!cfg) return;

          const enabledEl = document.getElementById('commandsEnabled');
          if (enabledEl) enabledEl.checked = cfg.enabled;

          const handlesEl = document.getElementById('trustedHandles');
          if (handlesEl && cfg.trustedHandles) handlesEl.value = cfg.trustedHandles.join('\\n');

          const pollEl = document.getElementById('commandsPollInterval');
          if (pollEl) pollEl.value = cfg.pollIntervalSec || 60;

          if (cfg.responseMessages) {
            const msgMap = {
              restart: 'msgRestart', sync: 'msgSync', source: 'msgSource',
              sourceChanged: 'msgSourceChanged', unauthorized: 'msgUnauthorized',
              error: 'msgError', unknown: 'msgUnknown'
            };
            for (const [key, id] of Object.entries(msgMap)) {
              const el = document.getElementById(id);
              const defaults = {
                restart: 'Restarting bot...', sync: 'Sync triggered!',
                source: 'Current source: @{handle}', sourceChanged: 'Source changed to @{handle}. Restarting...',
                unauthorized: 'You are not authorized to use commands.',
                error: 'Command failed: {error}',
                unknown: 'Unknown command. Available: !sync, !restart, !source, !status, !frequency, !posts, !bio, !avatar, !name, !header, !backdate, !help'
              };
              if (el && cfg.responseMessages[key] && cfg.responseMessages[key] !== defaults[key]) {
                el.value = cfg.responseMessages[key];
              }
            }
          }
        } catch (err) {
          console.error('Failed to load command config:', err);
        }
      }

      if (isEdit && botId) {
        loadCommandConfig();
      }

      // Load recent logs for edit mode
      if (isEdit && botId) {
        const levelColors = {
          info: 'text-blue-400',
          warn: 'text-amber-400',
          error: 'text-red-400',
          success: 'text-emerald-400',
        };

        fetch('/api/bots/' + botId + '/logs?limit=20')
          .then(r => r.json())
          .then(data => {
            const container = document.getElementById('recent-logs');
            if (!container) return;
            const logs = data.logs || [];
            if (logs.length === 0) {
              container.innerHTML = '<div class="text-slate-500">No logs yet</div>';
              return;
            }
            container.innerHTML = logs.map(log => {
              const time = new Date(log.timestamp).toLocaleTimeString();
              const levelClass = levelColors[log.level] || 'text-slate-400';
              const platform = log.platform ? '<span class="text-slate-500">[' + log.platform + ']</span> ' : '';
              return '<div class="flex gap-2 py-0.5">' +
                '<span class="text-slate-500 shrink-0">' + time + '</span>' +
                '<span class="font-medium shrink-0 ' + levelClass + '">' + log.level + '</span>' +
                '<span class="text-slate-300 truncate">' + platform + log.message + '</span>' +
              '</div>';
            }).join('');
          })
          .catch(() => {
            const container = document.getElementById('recent-logs');
            if (container) container.innerHTML = '<div class="text-slate-500">Failed to load logs</div>';
          });
      }
    </script>`,
  });
}
