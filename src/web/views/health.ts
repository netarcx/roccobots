import { layout } from "./layout";

export function healthPage(): string {
  return layout({
    title: "Health",
    authenticated: true,
    content: `
    <div class="flex items-center gap-3 mb-4">
      <a href="/" class="text-slate-400 hover:text-slate-200 transition-colors">&larr;</a>
      <h1 class="text-xl font-bold text-slate-100">Bot Health</h1>
      <div class="flex-1"></div>
      <button onclick="loadHealth()" class="bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm px-4 py-2 rounded transition-colors">Refresh</button>
    </div>
    <p class="text-sm text-slate-400 mb-6">Live overview of every bot's sync health. Rows turn <span class="text-amber-400">amber</span> after 1-2 failures and <span class="text-red-400">red</span> after 3+. Platform badges show per-platform failure counts; a red "PAUSED" badge means that platform is temporarily skipped to avoid repeated errors.</p>

    <div id="health-table-wrap">
      <div class="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-700 text-left text-slate-400">
              <th class="px-4 py-3 font-medium">Bot</th>
              <th class="px-4 py-3 font-medium">Status</th>
              <th class="px-4 py-3 font-medium">Last Sync</th>
              <th class="px-4 py-3 font-medium">Consecutive Failures</th>
              <th class="px-4 py-3 font-medium">Platform Status</th>
            </tr>
          </thead>
          <tbody id="health-tbody">
            <tr><td class="px-4 py-8 text-center text-slate-400" colspan="5">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>`,
    scripts: `
    <script>
      function esc(str) {
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
      }

      function timeAgo(dateStr) {
        if (!dateStr) return '-';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return mins + 'm ago';
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + 'h ago';
        return Math.floor(hrs / 24) + 'd ago';
      }

      function statusBadge(status) {
        const colors = {
          running: 'bg-emerald-500/20 text-emerald-400',
          syncing: 'bg-blue-500/20 text-blue-400',
          stopped: 'bg-slate-600/50 text-slate-400',
          error: 'bg-red-500/20 text-red-400',
        };
        const cls = colors[status] || colors.stopped;
        return '<span class="text-xs px-2 py-0.5 rounded ' + cls + '">' + esc(status) + '</span>';
      }

      function failureBadge(count) {
        if (count === 0) return '<span class="text-emerald-400">0</span>';
        if (count < 3) return '<span class="text-amber-400">' + count + '</span>';
        return '<span class="text-red-400 font-bold">' + count + '</span>';
      }

      function circuitBadges(circuits) {
        const entries = Object.entries(circuits || {});
        if (entries.length === 0) return '<span class="text-slate-500">No platforms active</span>';
        return entries.map(([platform, state]) => {
          const isOpen = state.openUntil && Date.now() < state.openUntil;
          const cls = isOpen ? 'bg-red-500/20 text-red-400' : (state.failures > 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400');
          var label;
          if (isOpen) {
            var resumeIn = Math.max(1, Math.ceil((state.openUntil - Date.now()) / 60000));
            label = esc(platform) + ' PAUSED (' + resumeIn + 'm)';
          } else if (state.failures > 0) {
            label = esc(platform) + ' ' + state.failures + ' fail(s)';
          } else {
            label = esc(platform) + ' OK';
          }
          return '<span class="text-xs px-2 py-0.5 rounded ' + cls + ' mr-1">' + label + '</span>';
        }).join('');
      }

      async function loadHealth() {
        try {
          const res = await fetch('/api/system/health');
          const data = await res.json();
          const tbody = document.getElementById('health-tbody');

          if (!data.bots || data.bots.length === 0) {
            tbody.innerHTML = '<tr><td class="px-4 py-8 text-center text-slate-400" colspan="5">No bots configured</td></tr>';
            return;
          }

          tbody.innerHTML = data.bots.map(b => {
            const rowClass = b.consecutiveFailures >= 3 ? 'bg-red-500/5' : (b.consecutiveFailures > 0 ? 'bg-amber-500/5' : '');
            return '<tr class="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ' + rowClass + '">' +
              '<td class="px-4 py-3 font-medium text-slate-200">@' + esc(b.twitterHandle) + '</td>' +
              '<td class="px-4 py-3">' + statusBadge(b.status?.status || (b.isRunning ? 'running' : 'stopped')) + '</td>' +
              '<td class="px-4 py-3 text-slate-400 text-xs">' + timeAgo(b.status?.lastSyncAt) + '</td>' +
              '<td class="px-4 py-3">' + failureBadge(b.consecutiveFailures) + '</td>' +
              '<td class="px-4 py-3">' + circuitBadges(b.circuitState) + '</td>' +
            '</tr>';
          }).join('');
        } catch (err) {
          showToast('Failed to load health data', 'error');
        }
      }

      // Listen for real-time updates
      const evtSource = new EventSource('/api/events');
      evtSource.addEventListener('statusChange', () => loadHealth());
      evtSource.onerror = () => {};

      loadHealth();
    </script>`,
  });
}
