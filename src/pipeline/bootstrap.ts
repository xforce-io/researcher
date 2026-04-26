import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectYaml } from '../config/project-yaml.js';
import { loadThesis } from '../config/thesis-md.js';
import { resolveProjectResearcherDir, resolveResearcherHome } from '../paths.js';
import type { AgentRuntime } from '../adapter/interface.js';
import type { RunDir } from '../state/runs.js';
import type { RunContext } from './context.js';

export interface BootstrapInput {
  projectRoot: string;
  adapter: AgentRuntime;
  runDir: RunDir;
  addArxivId?: string;
}

export async function bootstrap(input: BootstrapInput): Promise<RunContext> {
  const researcherDir = resolveProjectResearcherDir(input.projectRoot);
  const projectYaml = loadProjectYaml(join(researcherDir, 'project.yaml'));
  const thesis = loadThesis(join(researcherDir, 'thesis.md'));
  const methodologyDir = join(resolveResearcherHome(), 'methodology');
  const methodology = new Map<string, string>();
  for (const f of readdirSync(methodologyDir).sort()) {
    methodology.set(f, readFileSync(join(methodologyDir, f), 'utf8'));
  }
  if (methodology.size === 0) {
    throw new Error(`no methodology files at ${methodologyDir}; run \`researcher methodology install\``);
  }
  return {
    projectRoot: input.projectRoot,
    researcherDir,
    projectYaml,
    thesis,
    methodology,
    adapter: input.adapter,
    runDir: input.runDir,
    addArxivId: input.addArxivId,
  };
}
