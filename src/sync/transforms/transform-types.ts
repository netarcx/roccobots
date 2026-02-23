import { z } from "zod";

const PrependRuleSchema = z.object({
  type: z.literal("prepend"),
  text: z.string(),
});

const AppendRuleSchema = z.object({
  type: z.literal("append"),
  text: z.string(),
});

const RegexReplaceRuleSchema = z.object({
  type: z.literal("regex_replace"),
  pattern: z.string(),
  flags: z.string().default(""),
  replacement: z.string(),
});

const StripUrlsRuleSchema = z.object({
  type: z.literal("strip_urls"),
  pattern: z.string(),
});

const AddHashtagsRuleSchema = z.object({
  type: z.literal("add_hashtags"),
  hashtags: z.array(z.string()),
});

export const TransformRuleSchema = z.discriminatedUnion("type", [
  PrependRuleSchema,
  AppendRuleSchema,
  RegexReplaceRuleSchema,
  StripUrlsRuleSchema,
  AddHashtagsRuleSchema,
]);

export type TransformRule = z.infer<typeof TransformRuleSchema>;

export const TransformRulesConfigSchema = z.object({
  global: z.array(TransformRuleSchema).default([]),
  platforms: z.record(z.string(), z.array(TransformRuleSchema)).default({}),
});

export type TransformRulesConfig = z.infer<typeof TransformRulesConfigSchema>;
