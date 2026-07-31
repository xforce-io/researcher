import { join } from 'node:path';
import { loadGlobalConfig } from '../config/global-config.js';
import { resolveResearcherHome } from '../paths.js';
import { GrokCliAdapter } from './grok-cli.js';
import type { AgentRuntime } from './interface.js';
import { MilkieAdapter } from './milkie.js';

export function createAgentRuntime(home = resolveResearcherHome()): AgentRuntime {
  const config = loadGlobalConfig(join(home, 'config.yaml'));
  return config.runtime === 'grok-cli'
    ? new GrokCliAdapter(config.runtime_options['grok-cli'])
    : new MilkieAdapter();
}
