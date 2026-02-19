import { layout } from "./layout";

interface SettingsData {
  twitterAuthConfigured: boolean;
  twitterUsername: string | null;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function settingsPage(data: SettingsData): string {
  return layout({
    title: "Settings",
    authenticated: true,
    content: `
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <a href="/" class="text-slate-400 hover:text-slate-200 transition-colors">&larr;</a>
        <h1 class="text-xl font-bold text-slate-100">Settings</h1>
      </div>

      <!-- Twitter Auth -->
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Twitter Authentication</h2>
          ${data.twitterAuthConfigured ? '<span class="text-xs font-medium px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Configured</span>' : '<span class="text-xs font-medium px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">Not Configured</span>'}
        </div>
        <p class="text-sm text-slate-400 mb-4">These credentials are used by all bots to read tweets from Twitter. Only one Twitter login is needed.</p>

        <form id="twitter-auth-form" onsubmit="saveTwitterAuth(event)">
          <div class="space-y-4">
            <div>
              <label class="block text-sm text-slate-400 mb-1">Twitter Username (email)</label>
              <input type="text" id="twitterUsername" value="${escapeAttr(data.twitterUsername || "")}" required
                class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                placeholder="email@example.com">
            </div>
            <div>
              <label class="block text-sm text-slate-400 mb-1">Twitter Password</label>
              <input type="password" id="twitterPassword" ${data.twitterAuthConfigured ? "" : "required"}
                class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                placeholder="${data.twitterAuthConfigured ? "Leave blank to keep current" : "Password"}">
            </div>
          </div>
          <div class="mt-4">
            <button type="submit" id="twitter-auth-btn" class="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-6 py-2.5 rounded transition-colors">
              ${data.twitterAuthConfigured ? "Update Credentials" : "Save Credentials"}
            </button>
          </div>
        </form>
      </div>

      <!-- Backup & Restore -->
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-6">
        <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">Backup &amp; Restore</h2>
        <p class="text-sm text-slate-400 mb-4">Export all bot configurations, platform credentials, and sync state to a JSON file. Use this to migrate to another server or create a backup.</p>
        <p class="text-xs text-amber-400/80 mb-4">The backup file contains plaintext credentials. Store it securely and delete it after use.</p>

        <div class="flex flex-wrap gap-3">
          <a href="/api/system/backup" download class="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-6 py-2.5 rounded transition-colors inline-block">
            Download Backup
          </a>

          <div class="flex items-center gap-2">
            <label class="bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium px-6 py-2.5 rounded transition-colors cursor-pointer inline-block">
              Restore from Backup
              <input type="file" id="restore-file" accept=".json" class="hidden" onchange="handleRestoreFile(this)">
            </label>
          </div>
        </div>

        <div id="restore-status" class="mt-4 hidden">
          <div id="restore-preview" class="bg-slate-900 border border-slate-700 rounded p-4 text-sm text-slate-300">
          </div>
          <div class="mt-3 flex gap-3">
            <button onclick="confirmRestore()" id="restore-confirm-btn" class="bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium px-6 py-2.5 rounded transition-colors">
              Confirm Restore
            </button>
            <button onclick="cancelRestore()" class="bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium px-4 py-2.5 rounded transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>`,
    scripts: `
    <script>
      let pendingRestoreData = null;

      function handleRestoreFile(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
          try {
            const data = JSON.parse(e.target.result);
            if (data.version !== 1) {
              showToast('Unsupported backup version', 'error');
              return;
            }
            pendingRestoreData = data;
            const preview = document.getElementById('restore-preview');
            const botCount = data.bots ? data.bots.length : 0;
            const platformCount = data.bots ? data.bots.reduce((s, b) => s + (b.platforms ? b.platforms.length : 0), 0) : 0;
            const syncCount = data.syncState ? data.syncState.length : 0;
            preview.innerHTML = '<strong class="text-slate-100">Backup contents:</strong><br>' +
              'Exported: ' + new Date(data.exportedAt).toLocaleString() + '<br>' +
              'Bots: ' + botCount + '<br>' +
              'Platform configs: ' + platformCount + '<br>' +
              'Sync state entries: ' + syncCount + '<br>' +
              'Twitter auth: ' + (data.twitterAuth ? 'Yes (' + data.twitterAuth.username + ')' : 'No');
            document.getElementById('restore-status').classList.remove('hidden');
          } catch (err) {
            showToast('Invalid JSON file', 'error');
          }
        };
        reader.readAsText(file);
      }

      function cancelRestore() {
        pendingRestoreData = null;
        document.getElementById('restore-status').classList.add('hidden');
        document.getElementById('restore-file').value = '';
      }

      async function confirmRestore() {
        if (!pendingRestoreData) return;
        const btn = document.getElementById('restore-confirm-btn');
        btn.disabled = true;
        btn.textContent = 'Restoring...';
        try {
          const res = await fetch('/api/system/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pendingRestoreData),
          });
          const result = await res.json();
          if (!res.ok) {
            throw new Error(result.error || 'Restore failed');
          }
          let msg = 'Restored ' + result.botsCreated + ' bot(s), ' + result.platformsCreated + ' platform(s), ' + result.syncStateRestored + ' sync entries.';
          if (result.botsSkipped.length > 0) {
            msg += ' Skipped: ' + result.botsSkipped.join(', ');
          }
          if (result.errors.length > 0) {
            msg += ' Errors: ' + result.errors.join('; ');
          }
          showToast(msg, result.errors.length > 0 ? 'warning' : 'success');
          cancelRestore();
          setTimeout(() => window.location.reload(), 2000);
        } catch (err) {
          showToast(err.message || 'Restore failed', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Confirm Restore';
        }
      }

      async function saveTwitterAuth(e) {
        e.preventDefault();
        const btn = document.getElementById('twitter-auth-btn');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        try {
          const username = document.getElementById('twitterUsername').value;
          const password = document.getElementById('twitterPassword').value;

          if (!password && !${data.twitterAuthConfigured}) {
            showToast('Password is required', 'error');
            return;
          }

          const body = { username };
          if (password) body.password = password;
          else {
            showToast('Enter a password to update credentials', 'warning');
            return;
          }

          const res = await fetch('/api/system/settings/twitter-auth', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to save');
          }

          showToast('Twitter credentials saved', 'success');
          setTimeout(() => window.location.reload(), 1000);
        } catch (err) {
          showToast(err.message || 'Something went wrong', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = '${data.twitterAuthConfigured ? "Update Credentials" : "Save Credentials"}';
        }
      }
    </script>`,
  });
}
