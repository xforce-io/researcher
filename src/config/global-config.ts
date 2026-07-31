import { existsSync, readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';

const defaultGrokCliOptions = { bin: 'grok', model: 'grok-4.5' };

const GrokCliOptionsSchema = z.object({
  bin: z.string().min(1).default(defaultGrokCliOptions.bin),
  model: z.string().min(1).default(defaultGrokCliOptions.model),
}).default(defaultGrokCliOptions);

export const GlobalConfigSchema = z
  .object({
    runtime: z.enum(['milkie', 'grok-cli']).default('milkie'),
    runtime_options: z.object({
      'grok-cli': GrokCliOptionsSchema,
    }).default({ 'grok-cli': defaultGrokCliOptions }),
  })
  .default({ runtime: 'milkie', runtime_options: { 'grok-cli': defaultGrokCliOptions } });
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export function loadGlobalConfig(path: string): GlobalConfig {
  if (!existsSync(path)) return GlobalConfigSchema.parse({});
  const raw = parseYaml(readFileSync(path, 'utf8'));
  return GlobalConfigSchema.parse(raw ?? {});
}
