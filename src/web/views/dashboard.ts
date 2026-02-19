import { layout } from "./layout";

export function dashboardPage(): string {
    return layout({
        title: "Dashboard",
        authenticated: true,
        content: `
    <!-- Twitter Auth Warning -->
    <div id="twitter-auth-warning" class="hidden bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
      <div class="flex items-center gap-3">
        <span class="text-amber-400 text-lg">&#9888;</span>
        <div class="flex-1">
          <div class="text-sm font-medium text-amber-300">Twitter credentials not configured</div>
          <div class="text-xs text-amber-400/80 mt-0.5">Bots cannot start without Twitter login credentials. Configure them in Settings.</div>
        </div>
        <a href="/settings" class="text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded transition-colors">Go to Settings</a>
      </div>
    </div>

    <!-- Stats -->
    <div id="stats" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <div class="text-sm text-slate-400">Total Bots</div>
        <div id="stat-total" class="text-2xl font-bold text-slate-100">-</div>
      </div>
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <div class="text-sm text-slate-400">Running</div>
        <div id="stat-running" class="text-2xl font-bold text-emerald-400">-</div>
      </div>
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <div class="text-sm text-slate-400">Stopped</div>
        <div id="stat-stopped" class="text-2xl font-bold text-slate-400">-</div>
      </div>
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <div class="text-sm text-slate-400">Errors</div>
        <div id="stat-errors" class="text-2xl font-bold text-red-400">-</div>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex flex-wrap items-center gap-3 mb-6">
      <a href="/bots/new" class="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded transition-colors">Add Bot</a>
      <button onclick="importEnv()" class="bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium px-4 py-2 rounded transition-colors">Import from .env</button>
      <div class="flex-1"></div>
      <button onclick="startAll()" class="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded transition-colors">Start All</button>
      <button onclick="stopAll()" class="bg-red-600 hover:bg-red-500 text-white text-sm font-medium px-4 py-2 rounded transition-colors">Stop All</button>
    </div>

    <!-- Bot Cards -->
    <div id="bots-list" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div class="text-slate-400 text-sm">Loading bots...</div>
    </div>`,
        scripts: `
    <script>
      let eventSource = null;

      const statusColors = {
        running: 'bg-emerald-500/20 text-emerald-400',
        stopped: 'bg-slate-500/20 text-slate-400',
        error: 'bg-red-500/20 text-red-400',
        syncing: 'bg-blue-500/20 text-blue-400',
      };

      const platformColors = {
        bluesky: 'bg-blue-500/20 text-blue-400',
        mastodon: 'bg-purple-500/20 text-purple-400',
        misskey: 'bg-green-500/20 text-green-400',
        discord: 'bg-indigo-500/20 text-indigo-400',
      };

      function timeAgo(dateStr) {
        if (!dateStr) return 'Never';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return mins + 'm ago';
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + 'h ago';
        return Math.floor(hrs / 24) + 'd ago';
      }

      function esc(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
      }

      function renderBotCard(bot) {
        const status = bot.status?.status || 'stopped';
        const statusClass = statusColors[status] || statusColors.stopped;
        const platforms = (bot.platforms || []).map(p =>
          '<span class="text-xs px-1.5 py-0.5 rounded ' + (platformColors[p.platformId] || 'bg-slate-500/20 text-slate-400') + '">' + esc(p.platformId) + '</span>'
        ).join(' ');

        const lastSync = bot.status?.lastSyncAt ? timeAgo(bot.status.lastSyncAt) : 'Never';
        const nextSync = bot.status?.nextSyncAt ? timeAgo(bot.status.nextSyncAt) : '-';
        const errorMsg = status === 'error' && bot.status?.errorMessage
          ? '<div class="mt-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2 truncate">' + esc(bot.status.errorMessage) + '</div>'
          : '';

        return '<div class="bg-slate-800 border border-slate-700 rounded-lg p-4" data-bot-id="' + bot.id + '">' +
          '<div class="flex items-center justify-between mb-2">' +
            '<h3 class="font-semibold text-slate-100">@' + esc(bot.twitterHandle) + '</h3>' +
            '<span class="text-xs font-medium px-2 py-0.5 rounded ' + statusClass + '">' + status + '</span>' +
          '</div>' +
          '<div class="text-xs text-slate-400 space-y-1 mb-3">' +
            '<div>Sync every ' + bot.syncFrequencyMin + ' min</div>' +
            '<div>Last sync: ' + lastSync + '</div>' +
            (platforms ? '<div class="flex flex-wrap gap-1 mt-1">' + platforms + '</div>' : '') +
          '</div>' +
          errorMsg +
          '<div class="flex items-center gap-2 mt-3 pt-3 border-t border-slate-700">' +
            (bot.isRunning
              ? '<button onclick="stopBot(' + bot.id + ')" class="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded transition-colors">Stop</button>'
              : '<button onclick="startBot(' + bot.id + ')" class="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded transition-colors">Start</button>'
            ) +
            '<a href="/bots/' + bot.id + '" class="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded transition-colors">Edit</a>' +
            '<a href="/bots/' + bot.id + '/logs" class="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded transition-colors">Logs</a>' +
            '<div class="flex-1"></div>' +
            '<button onclick="deleteBot(' + bot.id + ')" class="text-xs text-red-400 hover:text-red-300 transition-colors">Delete</button>' +
          '</div>' +
        '</div>';
      }

      async function loadBots() {
        try {
          const res = await fetch('/api/bots');
          const data = await res.json();
          const list = document.getElementById('bots-list');

          // Update stats
          const bots = data.bots || [];
          const running = bots.filter(b => b.isRunning).length;
          const errors = bots.filter(b => b.status?.status === 'error').length;
          document.getElementById('stat-total').textContent = bots.length;
          document.getElementById('stat-running').textContent = running;
          document.getElementById('stat-stopped').textContent = bots.length - running - errors;
          document.getElementById('stat-errors').textContent = errors;

          if (bots.length === 0) {
            list.innerHTML = '<div class="col-span-full text-center py-12 text-slate-400">' +
              '<div class="text-4xl mb-3">No bots configured</div>' +
              '<p class="text-sm mb-4">Add a bot to get started, or import from your .env file.</p>' +
              '<a href="/bots/new" class="inline-block bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded transition-colors">Add Bot</a>' +
            '</div>';
            return;
          }

          list.innerHTML = bots.map(renderBotCard).join('');
        } catch (err) {
          console.error('Failed to load bots:', err);
        }
      }

      async function startBot(id) {
        try {
          const res = await fetch('/api/bots/' + id + '/start', { method: 'POST' });
          const data = await res.json();
          if (data.error) { showToast(data.error, 'error'); return; }
          showToast('Bot started', 'success');
          loadBots();
        } catch (err) { showToast('Failed to start bot', 'error'); }
      }

      async function stopBot(id) {
        try {
          const res = await fetch('/api/bots/' + id + '/stop', { method: 'POST' });
          const data = await res.json();
          if (data.error) { showToast(data.error, 'error'); return; }
          showToast('Bot stopped', 'success');
          loadBots();
        } catch (err) { showToast('Failed to stop bot', 'error'); }
      }

      async function deleteBot(id) {
        if (!confirm('Delete this bot? This cannot be undone.')) return;
        try {
          await fetch('/api/bots/' + id, { method: 'DELETE' });
          showToast('Bot deleted', 'success');
          loadBots();
        } catch (err) { showToast('Failed to delete bot', 'error'); }
      }

      async function startAll() {
        try {
          await fetch('/api/bots/start-all', { method: 'POST' });
          showToast('Starting all bots...', 'info');
          loadBots();
        } catch (err) { showToast('Failed to start bots', 'error'); }
      }

      async function stopAll() {
        try {
          await fetch('/api/bots/stop-all', { method: 'POST' });
          showToast('All bots stopped', 'success');
          loadBots();
        } catch (err) { showToast('Failed to stop bots', 'error'); }
      }

      async function importEnv() {
        try {
          const res = await fetch('/api/config/import-env', { method: 'POST' });
          const data = await res.json();
          if (data.created > 0) {
            showToast('Imported ' + data.created + ' bot(s)', 'success');
            loadBots();
          } else if (data.errors.length === 1 && data.errors[0].includes('No TWITTER_HANDLE')) {
            showToast('No Twitter handles found in .env', 'warning');
          } else if (data.errors.length > 0) {
            showToast('Import errors: ' + data.errors.join('; '), 'error', 8000);
          } else {
            showToast('No new bots to import', 'info');
          }
        } catch (err) { showToast('Failed to import', 'error'); }
      }

      // SSE for real-time updates
      function connectSSE() {
        eventSource = new EventSource('/api/events');
        eventSource.addEventListener('statusChange', () => loadBots());
        eventSource.addEventListener('botStarted', () => loadBots());
        eventSource.addEventListener('botStopped', () => loadBots());
        eventSource.onerror = () => {
          eventSource.close();
          setTimeout(connectSSE, 10000);
        };
      }

      // Check Twitter auth status
      async function checkTwitterAuth() {
        try {
          const res = await fetch('/api/system/settings/twitter-auth');
          const data = await res.json();
          if (!data.configured) {
            document.getElementById('twitter-auth-warning').classList.remove('hidden');
          }
        } catch (_) {}
      }

      loadBots();
      connectSSE();
      checkTwitterAuth();
    </script>`,
    });
}
