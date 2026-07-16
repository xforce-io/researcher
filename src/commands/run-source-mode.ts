/**
 * Explicit paper vs feed run-mode selection (#77).
 *
 * Previously `run` did `sources.find(x-inbox)` and exclusively ran the feed path,
 * silently starving arxiv discovery whenever both were listed. Dual config now
 * fails loudly; pure feed or pure paper configs keep working.
 */

export type RunSourceMode = 'feed' | 'paper';

export interface RunSourceLike {
  kind: string;
  queries?: string[];
}

const PLACEHOLDER_QUERY = 'your topic keyword';

/** True when a non-inbox source has at least one real discovery query. */
export function hasPaperDiscoveryQueries(sources: RunSourceLike[]): boolean {
  return sources.some(
    (s) =>
      s.kind !== 'x-inbox' &&
      Array.isArray(s.queries) &&
      s.queries.some((q) => q.trim() !== '' && q !== PLACEHOLDER_QUERY),
  );
}

/**
 * Resolve which pipeline this tick should run.
 * @throws Error when both x-inbox and paper discovery queries are configured.
 */
export function resolveRunSourceMode(sources: RunSourceLike[]): RunSourceMode {
  const hasFeed = sources.some((s) => s.kind === 'x-inbox');
  const hasPaper = hasPaperDiscoveryQueries(sources);
  if (hasFeed && hasPaper) {
    throw new Error(
      'conflicting sources in project.yaml: x-inbox and paper discovery (e.g. arxiv queries) ' +
        'cannot share one autonomous tick. Remove x-inbox for paper runs, or keep only x-inbox ' +
        'for feed runs (split topics if you need both). See issue #77.',
    );
  }
  return hasFeed ? 'feed' : 'paper';
}
