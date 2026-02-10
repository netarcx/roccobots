#!/usr/bin/env node

/**
 * Patches @the-convocation/twitter-scraper with updated GraphQL query IDs.
 *
 * Twitter rotates these IDs with frontend deployments. When syncing starts
 * returning 404 errors, grab fresh IDs from browser DevTools (Network tab,
 * filter "graphql") and update the map below.
 *
 * Run manually:  node scripts/patch-twitter-scraper.js
 * Runs automatically on: bun install (via postinstall)
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

// Map of old query ID -> new query ID
// To update: replace the values with fresh IDs from browser DevTools
const QUERY_ID_PATCHES = {
  // UserByScreenName
  "-oaLodhGbbnzJBACb1kk2Q": "AWbeRIdkLtqTRN7yL_H8yw",
  // UserTweets
  "oRJs8SLCRNRbQzuZG93_oA": "SURb7otVJKay5ECsD8ffXA",
};

const scraperDir = join(
  process.cwd(),
  "node_modules",
  "@the-convocation",
  "twitter-scraper",
  "dist",
);

let patchedFiles = 0;
let patchedIds = 0;

function patchDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      patchDir(fullPath);
    } else if (
      entry.name.endsWith(".mjs") ||
      entry.name.endsWith(".js") ||
      entry.name.endsWith(".cjs")
    ) {
      let content = readFileSync(fullPath, "utf-8");
      let changed = false;

      for (const [oldId, newId] of Object.entries(QUERY_ID_PATCHES)) {
        if (content.includes(oldId)) {
          content = content.replaceAll(oldId, newId);
          changed = true;
          patchedIds++;
        }
      }

      if (changed) {
        writeFileSync(fullPath, content);
        patchedFiles++;
      }
    }
  }
}

patchDir(scraperDir);

if (patchedFiles > 0) {
  console.log(
    `[patch-twitter-scraper] Patched ${patchedIds} query ID(s) in ${patchedFiles} file(s)`,
  );
} else {
  console.log("[patch-twitter-scraper] No files needed patching");
}
