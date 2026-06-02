import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceCharter, syncCharterToTopic, SYNCED_CHARTER_HEADER } from '../../src/workspace/charter.js';

const CHARTER = `# CHARTER

## 0. North star

Build the foundation for stable long-horizon agent execution.

## 1. Shared boundaries

- data supplies knowledge; execution supplies action.

## 2. Per-pillar excerpts

### \`trace\`
- Mandate: observability and diagnosis.
- Boundary: signals only, not artifact改.

### \`decision\`
- Mandate: decide and orchestrate.
`;

describe('sliceCharter', () => {
  it('extracts shared core (everything before first ### heading)', () => {
    const { sharedCore } = sliceCharter(CHARTER, 'trace');
    expect(sharedCore).toContain('North star');
    expect(sharedCore).toContain('Shared boundaries');
    expect(sharedCore).not.toContain('Mandate: observability');
  });

  it('extracts the matching pillar excerpt block', () => {
    const { excerpt } = sliceCharter(CHARTER, 'trace');
    expect(excerpt).toContain('### `trace`');
    expect(excerpt).toContain('observability and diagnosis');
    // stops before the next pillar
    expect(excerpt).not.toContain('decide and orchestrate');
  });

  it('isolates the last pillar excerpt to EOF', () => {
    const { excerpt } = sliceCharter(CHARTER, 'decision');
    expect(excerpt).toContain('decide and orchestrate');
    expect(excerpt).not.toContain('observability');
  });

  it('combined carries the AUTO-SYNCED header + shared core + excerpt', () => {
    const { combined } = sliceCharter(CHARTER, 'trace');
    expect(combined.startsWith(SYNCED_CHARTER_HEADER)).toBe(true);
    expect(combined).toContain('North star');
    expect(combined).toContain('observability and diagnosis');
  });

  it('returns null excerpt for an unknown pillar but still gives shared core', () => {
    const { excerpt, combined } = sliceCharter(CHARTER, 'ontology');
    expect(excerpt).toBeNull();
    expect(combined).toContain('North star');
  });
});

describe('syncCharterToTopic', () => {
  it('writes .researcher/charter.md when the topic has a .researcher dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-'));
    mkdirSync(join(root, 'trace', '.researcher'), { recursive: true });
    const out = syncCharterToTopic(root, 'trace', CHARTER);
    expect(out).toBe(join(root, 'trace', '.researcher', 'charter.md'));
    const written = readFileSync(out!, 'utf8');
    expect(written).toContain(SYNCED_CHARTER_HEADER.trim().slice(0, 20));
    expect(written).toContain('observability and diagnosis');
  });

  it('is a no-op (returns null) when the topic has no .researcher dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-'));
    mkdirSync(join(root, 'trace'), { recursive: true });
    expect(syncCharterToTopic(root, 'trace', CHARTER)).toBeNull();
    expect(existsSync(join(root, 'trace', '.researcher', 'charter.md'))).toBe(false);
  });
});
