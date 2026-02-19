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
    </div>`,
        scripts: `
    <script>
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
