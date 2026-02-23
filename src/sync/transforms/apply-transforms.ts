import { TransformRule, TransformRulesConfig } from "./transform-types";

function applyRule(text: string, rule: TransformRule): string {
  switch (rule.type) {
    case "prepend":
      return rule.text + text;

    case "append":
      return text + rule.text;

    case "regex_replace": {
      const regex = new RegExp(rule.pattern, rule.flags);
      return text.replace(regex, rule.replacement);
    }

    case "strip_urls": {
      const urlRegex = new RegExp(rule.pattern, "g");
      return text.replace(urlRegex, "").replace(/  +/g, " ").trim();
    }

    case "add_hashtags": {
      const tags = rule.hashtags
        .map((h) => (h.startsWith("#") ? h : `#${h}`))
        .join(" ");
      return text ? `${text}\n${tags}` : tags;
    }
  }
}

/**
 * Apply global + platform-specific transform rules to post text.
 * Returns the original text if no config is provided or no rules match.
 */
export function applyTransformRules(
  text: string,
  config: TransformRulesConfig | null | undefined,
  platformId: string,
): string {
  if (!config) return text;

  let result = text;

  // Apply global rules first
  for (const rule of config.global) {
    result = applyRule(result, rule);
  }

  // Apply platform-specific rules
  const platformRules = config.platforms[platformId];
  if (platformRules) {
    for (const rule of platformRules) {
      result = applyRule(result, rule);
    }
  }

  return result;
}
