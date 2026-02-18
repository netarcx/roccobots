export interface PlatformField {
    key: string;
    label: string;
    type: "text" | "password" | "url";
    placeholder: string;
    defaultValue?: string;
}

export interface PlatformDefinition {
    displayName: string;
    color: string;
    fields: PlatformField[];
}

export const PLATFORM_DEFS: Record<string, PlatformDefinition> = {
    bluesky: {
        displayName: "Bluesky",
        color: "blue",
        fields: [
            {
                key: "BLUESKY_INSTANCE",
                label: "Instance",
                type: "text",
                placeholder: "bsky.social",
                defaultValue: "bsky.social",
            },
            {
                key: "BLUESKY_IDENTIFIER",
                label: "Identifier (handle or email)",
                type: "text",
                placeholder: "user.bsky.social",
            },
            {
                key: "BLUESKY_PASSWORD",
                label: "App Password",
                type: "password",
                placeholder: "xxxx-xxxx-xxxx-xxxx",
            },
        ],
    },
    mastodon: {
        displayName: "Mastodon",
        color: "purple",
        fields: [
            {
                key: "MASTODON_INSTANCE",
                label: "Instance",
                type: "text",
                placeholder: "mastodon.social",
                defaultValue: "mastodon.social",
            },
            {
                key: "MASTODON_ACCESS_TOKEN",
                label: "Access Token",
                type: "password",
                placeholder: "Your access token",
            },
        ],
    },
    misskey: {
        displayName: "Misskey",
        color: "green",
        fields: [
            {
                key: "MISSKEY_INSTANCE",
                label: "Instance",
                type: "text",
                placeholder: "misskey.io",
            },
            {
                key: "MISSKEY_ACCESS_CODE",
                label: "Access Token",
                type: "password",
                placeholder: "Your access token",
            },
        ],
    },
    discord: {
        displayName: "Discord (Webhook)",
        color: "indigo",
        fields: [
            {
                key: "DISCORD_WEBHOOK_URL",
                label: "Webhook URL",
                type: "url",
                placeholder: "https://discord.com/api/webhooks/...",
            },
        ],
    },
};

export const PLATFORM_IDS = Object.keys(PLATFORM_DEFS);

/**
 * Render a platform credential form (for use in bot-form.ts)
 */
export function renderPlatformForm(
    platformId: string,
    credentials: Record<string, string> = {},
    opts: { existing?: boolean } = {},
): string {
    const def = PLATFORM_DEFS[platformId];
    if (!def) return "";

    const colorMap: Record<string, string> = {
        blue: "border-blue-500/30 bg-blue-500/5",
        purple: "border-purple-500/30 bg-purple-500/5",
        green: "border-green-500/30 bg-green-500/5",
        indigo: "border-indigo-500/30 bg-indigo-500/5",
    };
    const badgeMap: Record<string, string> = {
        blue: "bg-blue-500/20 text-blue-400",
        purple: "bg-purple-500/20 text-purple-400",
        green: "bg-green-500/20 text-green-400",
        indigo: "bg-indigo-500/20 text-indigo-400",
    };

    const borderColor = colorMap[def.color] || colorMap.blue;
    const badge = badgeMap[def.color] || badgeMap.blue;

    const fields = def.fields
        .map((f) => {
            const value = credentials[f.key] ?? f.defaultValue ?? "";
            const inputType = f.type === "password" ? "password" : "text";
            return `
        <div>
          <label class="block text-sm text-slate-400 mb-1">${f.label}</label>
          <div class="flex gap-2">
            <input type="${inputType}" name="${f.key}" value="${escapeAttr(value)}"
              placeholder="${escapeAttr(f.placeholder)}"
              class="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500">
            ${f.type === "password" ? '<button type="button" onclick="togglePassword(this)" class="text-xs text-slate-400 hover:text-slate-200 px-2">Show</button>' : ""}
          </div>
        </div>`;
        })
        .join("");

    return `
    <div class="border rounded-lg p-4 ${borderColor}" data-platform="${platformId}">
      <div class="flex items-center justify-between mb-3">
        <span class="text-sm font-medium ${badge} px-2 py-0.5 rounded">${def.displayName}</span>
        ${opts.existing ? `<button type="button" onclick="removePlatform('${platformId}')" class="text-xs text-red-400 hover:text-red-300">Remove</button>` : ""}
      </div>
      <div class="space-y-3">
        ${fields}
      </div>
    </div>`;
}

function escapeAttr(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
