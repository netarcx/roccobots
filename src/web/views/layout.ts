export interface LayoutOptions {
    title: string;
    content: string;
    scripts?: string;
    authenticated?: boolean;
}

function nav(authenticated: boolean): string {
    if (!authenticated) return "";
    return `
    <nav class="bg-slate-800 border-b border-slate-700">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-14">
          <div class="flex items-center gap-6">
            <a href="/" class="text-lg font-bold text-blue-400 hover:text-blue-300">RoccoBots</a>
            <div class="hidden sm:flex items-center gap-1">
              <a href="/" class="px-3 py-1.5 rounded text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">Dashboard</a>
              <a href="/bots/new" class="px-3 py-1.5 rounded text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">Add Bot</a>
              <a href="/settings" class="px-3 py-1.5 rounded text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">Settings</a>
            </div>
          </div>
          <button onclick="logout()" class="text-sm text-slate-400 hover:text-white transition-colors">Logout</button>
        </div>
      </div>
    </nav>`;
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
        toast.innerHTML = '<span class="flex-1">' + message + '</span>' +
          '<button onclick="this.parentElement.remove()" class="text-white/70 hover:text-white text-lg leading-none">&times;</button>';
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
  ${nav(opts.authenticated ?? false)}
  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    ${opts.content}
  </main>
  ${toastContainer()}
  ${opts.scripts ?? ""}
</body>
</html>`;
}
