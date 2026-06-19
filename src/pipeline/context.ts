import type { ProjectYaml } from '../config/project-yaml.js';
import type { Thesis } from '../config/thesis-md.js';
import type { AgentRuntime } from '../adapter/interface.js';
import type { RunDir } from '../state/runs.js';
import type { PickedDigest } from '../sources/inbox.js';
import type { KeptItem } from '../config/feed-triaged.js';

export interface RunContext {
  projectRoot: string;
  researcherDir: string; // <projectRoot>/.researcher
  projectYaml: ProjectYaml;
  /** Output language for all agent prose (from project.yaml meta.language). */
  language: string;
  thesis: Thesis;
  methodology: Map<string, string>; // filename → content
  /** Synced anchor from the super-repo CHARTER.md (.researcher/charter.md), if present. */
  charter?: string;
  adapter: AgentRuntime;
  runDir: RunDir;
  // mode-specific
  addSourceId?: string;
  // feed mode (x-inbox)
  /** The inbox digest picked for this tick (set by the inline ingest in run.ts). */
  feedDigest?: PickedDigest;
  /** Thesis-relevant tweets kept by feed-triage; drives feed-synthesize. */
  keptItems?: KeptItem[];
  /** When discover_triage chose this paper, the reason it recorded — used by
   * package stage when writing seen.jsonl in autonomous mode. */
  triageReason?: string;
  /** Set by soul_bootstrap when it punts to the human (open_questions.md). */
  needsHumanInput?: boolean;
  // carries
  newNoteFilename?: string;
  newNoteContent?: string;
  contradictionsPath?: string;
  landscapeDiff?: string;
}
