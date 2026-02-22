import { layout } from "./layout";

export function logsPage(botId: number, twitterHandle: string): string {
  return layout({
    title: `Logs - @${twitterHandle}`,
    authenticated: true,
    content: `
    <div class="max-w-4xl mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <a href="/bots/${botId}" class="text-slate-400 hover:text-slate-200 transition-colors">&larr;</a>
        <h1 class="text-xl font-bold text-slate-100">Logs for @${twitterHandle}</h1>
      </div>

      <!-- Filters -->
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-1">
            <button onclick="setLevel('')" class="level-btn text-xs px-2.5 py-1 rounded font-medium transition-colors bg-slate-600 text-white" data-level="">All</button>
            <button onclick="setLevel('info')" class="level-btn text-xs px-2.5 py-1 rounded font-medium transition-colors bg-slate-700 text-slate-400 hover:text-slate-200" data-level="info">Info</button>
            <button onclick="setLevel('success')" class="level-btn text-xs px-2.5 py-1 rounded font-medium transition-colors bg-slate-700 text-slate-400 hover:text-slate-200" data-level="success">Success</button>
            <button onclick="setLevel('warn')" class="level-btn text-xs px-2.5 py-1 rounded font-medium transition-colors bg-slate-700 text-slate-400 hover:text-slate-200" data-level="warn">Warn</button>
            <button onclick="setLevel('error')" class="level-btn text-xs px-2.5 py-1 rounded font-medium transition-colors bg-slate-700 text-slate-400 hover:text-slate-200" data-level="error">Error</button>
          </div>
          <input type="text" id="search" placeholder="Search logs..." oninput="filterLogs()"
            class="flex-1 min-w-[200px] bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500">
        </div>
      </div>

      <!-- Logs -->
      <div class="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <div id="logs-container" class="max-h-[70vh] overflow-y-auto p-4 space-y-0.5 font-mono text-xs">
          <div class="text-slate-500">Loading...</div>
        </div>
        <div id="load-more-container" class="border-t border-slate-700 p-3 text-center hidden">
          <button onclick="loadMore()" id="load-more-btn" class="text-xs text-blue-400 hover:text-blue-300 transition-colors">Load more</button>
        </div>
      </div>
    </div>`,
    scripts: `
    <script>
      const botId = ${botId};
      let allLogs = [];
      let currentLevel = '';
      let offset = 0;
      const limit = 100;

      const levelColors = {
        info: 'text-blue-400',
        warn: 'text-amber-400',
        error: 'text-red-400',
        success: 'text-emerald-400',
      };

      const levelBg = {
        info: 'bg-blue-500/10',
        warn: 'bg-amber-500/10',
        error: 'bg-red-500/10',
        success: 'bg-emerald-500/10',
      };

      function renderLog(log) {
        const time = new Date(log.timestamp).toLocaleString();
        const levelClass = levelColors[log.level] || 'text-slate-400';
        const bgClass = levelBg[log.level] || '';
        const platform = log.platform
          ? '<span class="text-slate-500">[' + log.platform + ']</span> '
          : '';
        return '<div class="flex gap-3 py-1 px-2 rounded ' + bgClass + ' log-entry" data-level="' + log.level + '">' +
          '<span class="text-slate-500 shrink-0 w-40">' + time + '</span>' +
          '<span class="font-semibold shrink-0 w-14 ' + levelClass + '">' + log.level.toUpperCase() + '</span>' +
          '<span class="text-slate-300 break-all">' + platform + log.message + '</span>' +
        '</div>';
      }

      function renderLogs() {
        const container = document.getElementById('logs-container');
        const search = document.getElementById('search').value.toLowerCase();

        const filtered = allLogs.filter(log => {
          if (currentLevel && log.level !== currentLevel) return false;
          if (search && !log.message.toLowerCase().includes(search)) return false;
          return true;
        });

        if (filtered.length === 0) {
          container.innerHTML = '<div class="text-slate-500 text-center py-8">No logs found</div>';
          return;
        }

        container.innerHTML = filtered.map(renderLog).join('');
      }

      function setLevel(level) {
        currentLevel = level;
        document.querySelectorAll('.level-btn').forEach(btn => {
          if (btn.dataset.level === level) {
            btn.className = 'level-btn text-xs px-2.5 py-1 rounded font-medium transition-colors bg-slate-600 text-white';
          } else {
            btn.className = 'level-btn text-xs px-2.5 py-1 rounded font-medium transition-colors bg-slate-700 text-slate-400 hover:text-slate-200';
          }
        });
        renderLogs();
      }

      function filterLogs() {
        renderLogs();
      }

      async function loadLogs() {
        try {
          const res = await fetch('/api/bots/' + botId + '/logs?limit=' + limit + '&offset=' + offset);
          const data = await res.json();
          const logs = data.logs || [];

          allLogs = allLogs.concat(logs);
          renderLogs();

          const loadMoreEl = document.getElementById('load-more-container');
          if (logs.length >= limit) {
            loadMoreEl.classList.remove('hidden');
          } else {
            loadMoreEl.classList.add('hidden');
          }
        } catch (err) {
          document.getElementById('logs-container').innerHTML =
            '<div class="text-red-400 text-center py-8">Failed to load logs</div>';
        }
      }

      function loadMore() {
        offset += limit;
        loadLogs();
      }

      // SSE for real-time logs
      const eventSource = new EventSource('/api/events');
      eventSource.addEventListener('log', (e) => {
        try {
          const log = JSON.parse(e.data);
          if (log.botId === botId) {
            allLogs.unshift(log);
            renderLogs();
          }
        } catch (_) {}
      });
      eventSource.onerror = () => {
        eventSource.close();
        setTimeout(() => location.reload(), 10000);
      };

      loadLogs();
    </script>`,
  });
}
