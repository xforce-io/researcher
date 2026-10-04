import { existsSync, readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';

const defaultGrokCliOptions = { bin: 'grok', model: 'grok-4.5' };
const defaultUrlExtract = { minChars: 1000, minWords: 150 };

const GrokCliOptionsSchema = z.object({
  bin: z.string().min(1).default(defaultGrokCliOptions.bin),
  model: z.string().min(1).default(defaultGrokCliOptions.model),
}).default(defaultGrokCliOptions);

const UrlExtractSchema = z.object({
  minChars: z.number().int().positive().default(defaultUrlExtract.minChars),
  minWords: z.number().int().positive().default(defaultUrlExtract.minWords),
}).default(defaultUrlExtract);

export const GlobalConfigSchema = z
  .object({
    transport: z.string().optional(),
    runtime: z.string().optional(),
    protocol: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    contract_version: z.number().optional(),
    workspace: z.string().min(1).optional(),
    runtime_options: z.object({
      'grok-cli': GrokCliOptionsSchema,
    }).default({ 'grok-cli': defaultGrokCliOptions }),
    urlExtract: UrlExtractSchema,
  })
  .default({ runtime_options: { 'grok-cli': defaultGrokCliOptions }, urlExtract: defaultUrlExtract });
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export function loadGlobalConfig(path: string): GlobalConfig {
  if (!existsSync(path)) return GlobalConfigSchema.parse({});
  const raw = parseYaml(readFileSync(path, 'utf8'));
  return GlobalConfigSchema.parse(raw ?? {});
}
