import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadWorkspaceManifest,
  activeTopics,
  addTopicToManifest,
  hasWorkspaceManifest,
  resolveWorkspaceManifestPath,
  WorkspaceManifestError,
} from '../../src/workspace/manifest.js';

function writeManifest(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'r-ws-'));
  const p = resolveWorkspaceManifestPath(dir);
  writeFileSync(p, body);
  return p;
}

const VALID = `
version: 1
topics:
  - { path: trace, active: true }
  - { path: decision, active: false }
  - path: ontology
`;

describe('loadWorkspaceManifest', () => {
  it('parses a valid manifest and defaults active to false', () => {
    const m = loadWorkspaceManifest(writeManifest(VALID));
    expect(m.topics).toHaveLength(3);
    expect(m.topics[0]).toEqual({ path: 'trace', active: true });
    expect(m.topics[2]).toEqual({ path: 'ontology', active: false });
  });

  it('activeTopics returns only active:true, in order', () => {
    const m = loadWorkspaceManifest(writeManifest(VALID));
    expect(activeTopics(m).map((t) => t.path)).toEqual(['trace']);
  });

  it('rejects duplicate topic paths', () => {
    const p = writeManifest(`
version: 1
topics:
  - { path: trace, active: true }
  - { path: trace, active: false }
`);
    expect(() => loadWorkspaceManifest(p)).toThrow(WorkspaceManifestError);
  });

  it('rejects an unsupported version', () => {
    const p = writeManifest('version: 2\ntopics:\n  - { path: trace }\n');
    expect(() => loadWorkspaceManifest(p)).toThrow(WorkspaceManifestError);
  });

  it('rejects an empty topics list', () => {
    const p = writeManifest('version: 1\ntopics: []\n');
    expect(() => loadWorkspaceManifest(p)).toThrow(WorkspaceManifestError);
  });

  it('hasWorkspaceManifest detects presence', () => {
    const p = writeManifest(VALID);
    expect(hasWorkspaceManifest(join(p, '..'))).toBe(true);
    expect(hasWorkspaceManifest(mkdtempSync(join(tmpdir(), 'r-empty-')))).toBe(false);
  });
});

describe('addTopicToManifest', () => {
  it('appends an active topic and round-trips through load', () => {
    const p = writeManifest(VALID);
    const m = addTopicToManifest(p, { path: 'probe', active: true });
    expect(m.topics.map((t) => t.path)).toEqual(['trace', 'decision', 'ontology', 'probe']);
    expect(m.topics.at(-1)).toEqual({ path: 'probe', active: true });
    expect(loadWorkspaceManifest(p).topics.at(-1)).toEqual({ path: 'probe', active: true });
  });

  it('rejects a duplicate path without writing a second entry', () => {
    const p = writeManifest(VALID);
    expect(() => addTopicToManifest(p, { path: 'trace' })).toThrow(WorkspaceManifestError);
    expect(loadWorkspaceManifest(p).topics).toHaveLength(3);
  });
});
