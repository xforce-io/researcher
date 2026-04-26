import type { ProjectYaml } from '../config/project-yaml.js';
import type { Thesis } from '../config/thesis-md.js';
import type { AgentRuntime } from '../adapter/interface.js';
import type { RunDir } from '../state/runs.js';

export interface RunContext {
  projectRoot: string;
  researcherDir: string; // <projectRoot>/.researcher
  projectYaml: ProjectYaml;
  thesis: Thesis;
  methodology: Map<string, string>; // filename → content
  adapter: AgentRuntime;
  runDir: RunDir;
  // mode-specific
  addArxivId?: string;
  // carries
  newNoteFilename?: string;
  newNoteContent?: string;
  contradictionsPath?: string;
  landscapeDiff?: string;
}
