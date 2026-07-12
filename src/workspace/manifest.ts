import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump as dumpYaml, load as parseYaml } from 'js-yaml';
import { z } from 'zod';

export const WORKSPACE_MANIFEST = 'researcher.workspace.yml';

export class WorkspaceManifestError extends Error {
  constructor(message: string, public readonly path: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'WorkspaceManifestError';
  }
}

const Topic = z.object({
  /** Submodule directory name, relative to the super-repo root. */
  path: z.string().min(1),
  /** Whether this topic is actively researched. Dormant topics are never touched. */
  active: z.boolean().default(false),
});

export const WorkspaceManifestSchema = z.object({
  version: z.literal(1),
  topics: z.array(Topic).min(1),
});

export type WorkspaceManifest = z.infer<typeof WorkspaceManifestSchema>;
export type WorkspaceTopic = z.infer<typeof Topic>;

export function resolveWorkspaceManifestPath(cwd: string): string {
  return join(cwd, WORKSPACE_MANIFEST);
}

/** True when cwd looks like a super-repo (has a workspace manifest). */
export function hasWorkspaceManifest(cwd: string): boolean {
  return existsSync(resolveWorkspaceManifestPath(cwd));
}

export function loadWorkspaceManifest(path: string): WorkspaceManifest {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new WorkspaceManifestError(`failed to parse yaml at ${path}`, path, err);
  }
  const parsed = WorkspaceManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkspaceManifestError(
      `invalid ${WORKSPACE_MANIFEST} at ${path}: ${parsed.error.message}`,
      path,
      parsed.error,
    );
  }
  // Guard against duplicate paths — would make "active" ambiguous.
  const seen = new Set<string>();
  for (const t of parsed.data.topics) {
    if (seen.has(t.path)) {
      throw new WorkspaceManifestError(`duplicate topic path "${t.path}" in ${path}`, path);
    }
    seen.add(t.path);
  }
  return parsed.data;
}

export function activeTopics(manifest: WorkspaceManifest): WorkspaceTopic[] {
  return manifest.topics.filter((t) => t.active);
}

/** Append a topic to the workspace manifest and write it back. */
export function addTopicToManifest(
  manifestPath: string,
  topic: { path: string; active?: boolean },
): WorkspaceManifest {
  const manifest = loadWorkspaceManifest(manifestPath);
  if (manifest.topics.some((t) => t.path === topic.path)) {
    throw new WorkspaceManifestError(
      `duplicate topic path "${topic.path}" in ${manifestPath}`,
      manifestPath,
    );
  }
  const next: WorkspaceManifest = {
    version: 1,
    topics: [...manifest.topics, { path: topic.path, active: topic.active ?? true }],
  };
  writeFileSync(
    manifestPath,
    dumpYaml(next, { lineWidth: 120, noRefs: true, sortKeys: false }),
    'utf8',
  );
  // Re-load so callers always see schema-normalized data (e.g. active default).
  return loadWorkspaceManifest(manifestPath);
}
