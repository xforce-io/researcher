import type { ProjectYaml } from '../config/project-yaml.js';
import type { Thesis } from '../config/thesis-md.js';
import type { AgentRuntime } from '../adapter/interface.js';
import type { RunDir } from '../state/runs.js';


export interface RunContext {
  projectRoot: string;
  researcherDir: string; // <projectRoot>/.researcher
  projectYaml: ProjectYaml;
  /** Output language for all agent prose (from project.yaml meta.language). */
  language: string;
  /** Resolved from project.yaml delivery.mode — true only when mode: remote.
   * Gates push + PR in the package stage; local-only topics leave it false. */
  pushRemote: boolean;
  thesis: Thesis;
  methodology: Map<string, string>; // filename → content
  /** Synced anchor from the super-repo CHARTER.md (.researcher/charter.md), if present. */
  charter?: string;
  adapter: AgentRuntime;
  runDir: RunDir;
  // mode-specific
  addSourceId?: string;
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
  /** Relative path of the note written this run, including its zone subdir (e.g. notes/active/07_x.md). */
  newNoteRelPath?: string;
  /** Newline list "NN zone" for every note, injected into the synthesize prompt so it
   *  demotes history-zone papers to landscape archive / report appendix. */
  zoneManifest?: string;
  /**
   * Stashed by libraryTopicRead; applied by finalizeLibraryIntegration only after
   * synthesize proves the landscape file actually changed.
   */
  pendingLibraryIntegration?: {
    workspaceRoot: string;
    paperId: string;
    topicId: string;
    notePath: string;
    zone: 'active' | 'buffer' | 'history';
    summary?: string;
  };
}
