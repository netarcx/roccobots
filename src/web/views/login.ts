import { layout } from "./layout";

export function loginPage(): string {
    return layout({
        title: "Login",
        authenticated: false,
        content: `
    <div class="flex items-center justify-center min-h-[80vh]">
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-8 w-full max-w-sm">
        <h1 class="text-2xl font-bold text-blue-400 text-center mb-6">RoccoBots</h1>
        <form onsubmit="handleLogin(event)">
          <div class="mb-4">
            <label for="password" class="block text-sm text-slate-400 mb-1">Admin Password</label>
            <input type="password" id="password" name="password" required autofocus
              class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 rounded transition-colors">
            Login
          </button>
          <p id="error" class="text-red-400 text-sm mt-3 hidden"></p>
        </form>
      </div>
    </div>`,
        scripts: `
    <script>
      async function handleLogin(e) {
        e.preventDefault();
        const password = document.getElementById('password').value;
        const errorEl = document.getElementById('error');
        errorEl.classList.add('hidden');

        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (data.success) {
          window.location = '/';
        } else {
          errorEl.textContent = data.error || 'Login failed';
          errorEl.classList.remove('hidden');
        }
      }
    </script>`,
    });
}
