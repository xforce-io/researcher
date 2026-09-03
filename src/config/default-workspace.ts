import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { loadGlobalConfig } from './global-config.js';
import { resolveResearcherHome } from '../paths.js';
import { WORKSPACE_MANIFEST } from '../workspace/manifest.js';

export class DefaultWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefaultWorkspaceError';
  }
}

export function resolveDefaultWorkspace(opts: {
  flag?: string;
  env?: NodeJS.Dict<string>;
  home?: string;
  configPath?: string;
} = {}): string {
  const env = opts.env ?? process.env;
  const raw =
    trimPath(opts.flag) ||
    trimPath(env.RESEARCHER_WORKSPACE_ROOT) ||
    trimPath(configWorkspace(opts));
  if (!raw) {
    throw new DefaultWorkspaceError(
      'no default workspace: set workspace: /absolute/path in ~/.researcher/config.yaml, ' +
        'or RESEARCHER_WORKSPACE_ROOT, or pass --workspace',
    );
  }
  if (!isAbsolute(raw)) {
    throw new DefaultWorkspaceError(`workspace path must be absolute, got ${JSON.stringify(raw)}`);
  }
  const manifest = join(raw, WORKSPACE_MANIFEST);
  if (!existsSync(manifest)) {
    throw new DefaultWorkspaceError(
      `workspace path ${raw} has no ${WORKSPACE_MANIFEST}`,
    );
  }
  return raw;
}

function configWorkspace(opts: { home?: string; configPath?: string }): string | undefined {
  const path = opts.configPath ?? join(opts.home ?? resolveResearcherHome(), 'config.yaml');
  return loadGlobalConfig(path).workspace;
}

function trimPath(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}
