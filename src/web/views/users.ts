import { layout } from "./layout";

export function usersPage(): string {
  return layout({
    title: "Users",
    authenticated: true,
    role: "admin",
    content: `
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center gap-3 mb-4">
        <a href="/" class="text-slate-400 hover:text-slate-200 transition-colors">&larr;</a>
        <h1 class="text-xl font-bold text-slate-100">User Management</h1>
        <div class="flex-1"></div>
        <button onclick="showCreateForm()" class="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded transition-colors">Add User</button>
      </div>
      <p class="text-sm text-slate-400 mb-6"><strong class="text-slate-300">Admins</strong> can start/stop bots, edit settings, and manage users. <strong class="text-slate-300">Viewers</strong> can see the dashboard and logs but cannot make changes.</p>

      <!-- Create User Form (hidden by default) -->
      <div id="create-form" class="hidden bg-slate-800 border border-slate-700 rounded-lg p-6 mb-6">
        <h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">New User</h2>
        <form onsubmit="createUser(event)">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label class="block text-sm text-slate-400 mb-1">Username</label>
              <input type="text" id="new-username" required minlength="1" maxlength="64"
                class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500">
            </div>
            <div>
              <label class="block text-sm text-slate-400 mb-1">Password</label>
              <input type="password" id="new-password" required minlength="6"
                class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500">
            </div>
            <div>
              <label class="block text-sm text-slate-400 mb-1">Role</label>
              <select id="new-role" class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500">
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div class="flex gap-2">
            <button type="submit" class="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded transition-colors">Create</button>
            <button type="button" onclick="hideCreateForm()" class="bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm px-4 py-2 rounded transition-colors">Cancel</button>
          </div>
        </form>
      </div>

      <!-- Users List -->
      <div id="users-list" class="space-y-3"></div>
    </div>`,
    scripts: `
    <script>
      function esc(str) {
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
      }

      function showCreateForm() { document.getElementById('create-form').classList.remove('hidden'); }
      function hideCreateForm() { document.getElementById('create-form').classList.add('hidden'); }

      async function loadUsers() {
        const res = await fetch('/api/users');
        const data = await res.json();
        const list = document.getElementById('users-list');
        if (!data.users || data.users.length === 0) {
          list.innerHTML = '<div class="text-center py-8 text-slate-400">No users configured</div>';
          return;
        }
        list.innerHTML = data.users.map(u => {
          const roleBadge = u.role === 'admin'
            ? '<span class="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">Admin</span>'
            : '<span class="text-xs px-2 py-0.5 rounded bg-slate-600/50 text-slate-400">Viewer</span>';
          return '<div class="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center gap-4">' +
            '<div class="flex-1">' +
              '<span class="text-slate-200 font-medium">' + esc(u.username) + '</span> ' + roleBadge +
            '</div>' +
            '<select onchange="changeRole(' + u.id + ', this.value)" class="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200">' +
              '<option value="viewer"' + (u.role === 'viewer' ? ' selected' : '') + '>Viewer</option>' +
              '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
            '</select>' +
            '<button onclick="deleteUser(' + u.id + ', \\'' + esc(u.username) + '\\')" class="text-xs text-red-400 hover:text-red-300">Delete</button>' +
          '</div>';
        }).join('');
      }

      async function createUser(e) {
        e.preventDefault();
        const username = document.getElementById('new-username').value;
        const password = document.getElementById('new-password').value;
        const role = document.getElementById('new-role').value;
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, role })
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }
        showToast('User created', 'success');
        hideCreateForm();
        document.getElementById('new-username').value = '';
        document.getElementById('new-password').value = '';
        loadUsers();
      }

      async function changeRole(id, role) {
        const res = await fetch('/api/users/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role })
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }
        showToast('Role updated', 'success');
      }

      async function deleteUser(id, username) {
        if (!confirm('Delete user "' + username + '"?')) return;
        const res = await fetch('/api/users/' + id, { method: 'DELETE' });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }
        showToast('User deleted', 'success');
        loadUsers();
      }

      loadUsers();
    </script>`,
  });
}
