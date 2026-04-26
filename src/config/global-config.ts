import { existsSync, readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';

export const GlobalConfigSchema = z
  .object({
    runtime: z.enum(['claude-code']).default('claude-code'),
  })
  .default({ runtime: 'claude-code' });
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export function loadGlobalConfig(path: string): GlobalConfig {
  if (!existsSync(path)) return GlobalConfigSchema.parse({});
  const raw = parseYaml(readFileSync(path, 'utf8'));
  return GlobalConfigSchema.parse(raw ?? {});
}
