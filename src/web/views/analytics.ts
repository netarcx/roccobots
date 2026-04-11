import { layout } from "./layout";

export function analyticsPage(): string {
  return layout({
    title: "Analytics",
    authenticated: true,
    content: `
    <!-- Bot Selector -->
    <div class="flex flex-wrap items-center gap-3 mb-6">
      <h1 class="text-xl font-bold text-slate-100">Bluesky Analytics</h1>
      <div class="flex-1"></div>
      <select id="bot-select" onchange="selectBot(this.value)"
        class="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-blue-500">
        <option value="">Select a bot...</option>
      </select>
      <button id="refresh-btn" onclick="refreshMetrics()" disabled
        class="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-1.5 rounded transition-colors">
        Refresh from Bluesky
      </button>
    </div>

    <!-- Summary Cards -->
    <div id="summary-cards" class="hidden mb-6" style="display:none">
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <div class="text-sm text-slate-400">Total Likes</div>
        <div id="stat-likes" class="text-2xl font-bold text-pink-400">-</div>
      </div>
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <div class="text-sm text-slate-400">Total Reposts</div>
        <div id="stat-reposts" class="text-2xl font-bold text-green-400">-</div>
      </div>
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <div class="text-sm text-slate-400">Total Replies</div>
        <div id="stat-replies" class="text-2xl font-bold text-blue-400">-</div>
      </div>
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <div class="text-sm text-slate-400">Posts Tracked</div>
        <div id="stat-count" class="text-2xl font-bold text-slate-100">-</div>
      </div>
    </div>

    <!-- Analytics disabled state -->
    <div id="disabled-state" class="hidden text-center py-16 text-slate-400">
      <div class="text-4xl mb-3">Analytics disabled</div>
      <p class="text-sm mb-4">Enable "Bluesky Analytics" in this bot's settings to track engagement.</p>
      <a id="disabled-settings-link" href="/" class="inline-block text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-4 py-2 rounded transition-colors">Open Bot Settings</a>
    </div>

    <!-- Empty state -->
    <div id="empty-state" class="hidden text-center py-16 text-slate-400">
      <div class="text-4xl mb-3">No data yet</div>
      <p class="text-sm mb-4">Click "Refresh from Bluesky" to fetch engagement stats for synced posts.</p>
    </div>

    <!-- No bot selected -->
    <div id="no-bot-state" class="text-center py-16 text-slate-400">
      <div class="text-4xl mb-3">Select a bot</div>
      <p class="text-sm">Choose a bot from the dropdown above to view its Bluesky analytics.</p>
    </div>

    <!-- Metrics Table -->
    <div id="metrics-table-wrap" class="hidden">
      <div class="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-700 text-left text-slate-400">
              <th class="px-4 py-3 font-medium">Tweet</th>
              <th class="px-4 py-3 font-medium text-pink-400">&#10084; Likes</th>
              <th class="px-4 py-3 font-medium text-green-400">&#8635; Reposts</th>
              <th class="px-4 py-3 font-medium text-blue-400">&#128172; Replies</th>
              <th class="px-4 py-3 font-medium text-purple-400">&#128488; Quotes</th>
              <th class="px-4 py-3 font-medium text-slate-400">Updated</th>
            </tr>
          </thead>
          <tbody id="metrics-tbody"></tbody>
        </table>
      </div>
    </div>`,
    scripts: `
    <script>
      let selectedBotId = null;

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

      async function loadBots() {
        try {
          const res = await fetch('/api/bots');
          const data = await res.json();
          const select = document.getElementById('bot-select');
          (data.bots || []).forEach(bot => {
            const opt = document.createElement('option');
            opt.value = bot.id;
            opt.textContent = '@' + bot.twitterHandle;
            select.appendChild(opt);
          });
        } catch (err) {
          console.error('Failed to load bots:', err);
        }
      }

      async function selectBot(botId) {
        selectedBotId = botId || null;
        const refreshBtn = document.getElementById('refresh-btn');
        refreshBtn.disabled = !selectedBotId;

        if (!selectedBotId) {
          showState('no-bot');
          return;
        }

        // Update the settings link for the disabled state
        document.getElementById('disabled-settings-link').href = '/bots/' + selectedBotId;

        await loadMetrics();
      }

      async function loadMetrics() {
        if (!selectedBotId) return;
        try {
          const res = await fetch('/api/analytics/' + selectedBotId);
          const data = await res.json();
          if (data.error) { showToast(data.error, 'error'); return; }
          renderMetrics(data);
        } catch (err) {
          showToast('Failed to load metrics', 'error');
        }
      }

      function renderMetrics(data) {
        const { metrics, totals, count, analyticsEnabled } = data;

        if (!analyticsEnabled) {
          document.getElementById('refresh-btn').disabled = true;
          showState('disabled');
          return;
        }

        document.getElementById('refresh-btn').disabled = false;

        // Summary cards
        document.getElementById('stat-likes').textContent = totals.likes.toLocaleString();
        document.getElementById('stat-reposts').textContent = totals.reposts.toLocaleString();
        document.getElementById('stat-replies').textContent = totals.replies.toLocaleString();
        document.getElementById('stat-count').textContent = count.toLocaleString();

        if (count === 0) {
          showState('empty');
          return;
        }

        showState('table');

        const tbody = document.getElementById('metrics-tbody');
        tbody.innerHTML = metrics.map(m => {
          const twitterUrl = 'https://twitter.com/i/web/status/' + esc(m.tweetId);
          return '<tr class="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">' +
            '<td class="px-4 py-3">' +
              '<a href="' + twitterUrl + '" target="_blank" rel="noopener" ' +
                'class="text-blue-400 hover:text-blue-300 font-mono text-xs">' +
                esc(m.tweetId) +
              '</a>' +
            '</td>' +
            '<td class="px-4 py-3 text-pink-300 font-medium">' + esc(m.blueskyLikes) + '</td>' +
            '<td class="px-4 py-3 text-green-300 font-medium">' + esc(m.blueskyReposts) + '</td>' +
            '<td class="px-4 py-3 text-blue-300 font-medium">' + esc(m.blueskyReplies) + '</td>' +
            '<td class="px-4 py-3 text-purple-300 font-medium">' + esc(m.blueskyQuotes) + '</td>' +
            '<td class="px-4 py-3 text-slate-400 text-xs">' + timeAgo(m.recordedAt) + '</td>' +
          '</tr>';
        }).join('');
      }

      function showState(state) {
        document.getElementById('no-bot-state').style.display = 'none';
        document.getElementById('disabled-state').style.display = 'none';
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('metrics-table-wrap').style.display = 'none';
        document.getElementById('summary-cards').style.display = 'none';

        if (state === 'no-bot') {
          document.getElementById('no-bot-state').style.display = '';
        } else if (state === 'disabled') {
          document.getElementById('disabled-state').style.display = '';
        } else if (state === 'empty') {
          document.getElementById('summary-cards').style.display = 'grid';
          document.getElementById('summary-cards').style.gridTemplateColumns = 'repeat(2, 1fr)';
          document.getElementById('empty-state').style.display = '';
        } else if (state === 'table') {
          document.getElementById('summary-cards').style.display = 'grid';
          document.getElementById('summary-cards').style.gridTemplateColumns = 'repeat(2, 1fr)';
          document.getElementById('metrics-table-wrap').style.display = '';
        }
      }

      async function refreshMetrics() {
        if (!selectedBotId) return;
        const btn = document.getElementById('refresh-btn');
        btn.disabled = true;
        btn.textContent = 'Refreshing...';
        try {
          const res = await fetch('/api/analytics/' + selectedBotId + '/refresh', { method: 'POST' });
          const data = await res.json();
          if (data.error) {
            showToast(data.error, 'error');
          } else {
            showToast('Refreshed ' + data.refreshed + ' posts', 'success');
            await loadMetrics();
          }
        } catch (err) {
          showToast('Refresh failed', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Refresh from Bluesky';
        }
      }

      loadBots();
    </script>`,
  });
}
