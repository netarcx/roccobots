export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface LayoutOptions {
  title: string;
  content: string;
  scripts?: string;
  authenticated?: boolean;
  role?: string;
}

function navLink(href: string, label: string): string {
  return `<a href="${href}" class="px-3 py-1.5 rounded text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">${label}</a>`;
}

function mobileNavLink(href: string, label: string): string {
  return `<a href="${href}" class="block px-4 py-3 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">${label}</a>`;
}

function nav(authenticated: boolean, _role?: string): string {
  if (!authenticated) return "";
  return `
    <nav class="bg-slate-800 border-b border-slate-700">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-14">
          <div class="flex items-center gap-6">
            <a href="/" class="text-lg font-bold text-blue-400 hover:text-blue-300">RoccoBots</a>
            <div class="hidden sm:flex items-center gap-1">
              ${navLink("/", "Dashboard")}
              ${navLink("/bots/new", "Add Bot")}
              ${navLink("/health-dashboard", "Health")}
              ${navLink("/analytics", "Analytics")}
              ${navLink("/settings", "Settings")}
              <a href="/users" id="nav-users" class="hidden px-3 py-1.5 rounded text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">Users</a>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <button onclick="logout()" class="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors">Logout</button>
            <button onclick="toggleMobileMenu()" class="sm:hidden text-slate-400 hover:text-white p-1">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div id="mobile-menu" class="hidden sm:hidden border-t border-slate-700">
        ${mobileNavLink("/", "Dashboard")}
        ${mobileNavLink("/bots/new", "Add Bot")}
        ${mobileNavLink("/health-dashboard", "Health")}
        ${mobileNavLink("/analytics", "Analytics")}
        ${mobileNavLink("/settings", "Settings")}
        <a href="/users" id="nav-users-mobile" class="hidden block px-4 py-3 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">Users</a>
        <button onclick="logout()" class="block w-full text-left px-4 py-3 text-red-400 hover:text-red-300 hover:bg-slate-700 transition-colors">Logout</button>
      </div>
    </nav>
    <script>
      fetch('/api/auth/status').then(function(r){return r.json()}).then(function(d){
        if(d.role==='admin'){
          var e=document.getElementById('nav-users');if(e)e.classList.remove('hidden');
          var m=document.getElementById('nav-users-mobile');if(m)m.classList.remove('hidden');
        }
      }).catch(function(){});
    </script>`;
}

function toastContainer(): string {
  return `
    <div id="toast-container" class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"></div>
    <script>
      function showToast(message, type = 'info', duration = 5000) {
        const container = document.getElementById('toast-container');
        const colors = {
          success: 'bg-emerald-600 border-emerald-500',
          error: 'bg-red-600 border-red-500',
          warning: 'bg-amber-600 border-amber-500',
          info: 'bg-blue-600 border-blue-500',
        };
        const toast = document.createElement('div');
        toast.className = (colors[type] || colors.info) +
          ' pointer-events-auto border rounded-lg px-4 py-3 text-white text-sm shadow-lg ' +
          'transform transition-all duration-300 translate-x-[120%] opacity-0 max-w-sm flex items-center gap-2';
        const span = document.createElement('span');
        span.className = 'flex-1';
        span.textContent = message;
        const btn = document.createElement('button');
        btn.className = 'text-white/70 hover:text-white text-lg leading-none';
        btn.innerHTML = '&times;';
        btn.onclick = function() { toast.remove(); };
        toast.appendChild(span);
        toast.appendChild(btn);
        container.appendChild(toast);
        requestAnimationFrame(() => {
          toast.classList.remove('translate-x-[120%]', 'opacity-0');
        });
        setTimeout(() => {
          toast.classList.add('translate-x-[120%]', 'opacity-0');
          setTimeout(() => toast.remove(), 300);
        }, duration);
      }

      async function logout() {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location = '/login';
      }
    </script>`;
}

export function layout(opts: LayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${opts.title} - RoccoBots</title>
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {}
      }
    }
  </script>
</head>
<body class="bg-slate-900 text-slate-200 min-h-screen">
  ${nav(opts.authenticated ?? false, opts.role)}
  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    ${opts.content}
  </main>
  ${toastContainer()}
  <script>
    function toggleMobileMenu() {
      document.getElementById('mobile-menu')?.classList.toggle('hidden');
    }
  </script>
  ${opts.scripts ?? ""}
</body>
</html>`;
}
