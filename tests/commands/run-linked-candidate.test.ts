import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaperLibrary } from '../../src/library/store.js';
import { pickLinkedLibraryCandidate } from '../../src/commands/run.js';

describe('pickLinkedLibraryCandidate (#111)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'r-linked-'));
    mkdirSync(join(root, '.researcher-workspace/library'), { recursive: true });
    writeFileSync(join(root, '.researcher-workspace/library/papers.jsonl'), '');
    writeFileSync(join(root, '.researcher-workspace/library/links.jsonl'), '');
    writeFileSync(join(root, '.researcher-workspace/library/integrations.jsonl'), '');
    writeFileSync(join(root, '.researcher-workspace/library/reads.jsonl'), '');
    writeFileSync(join(root, '.researcher-workspace/library/notes.jsonl'), '');
  });

  it('returns oldest non-integrated arxiv link for the topic', () => {
    const lib = new PaperLibrary(root, { now: () => '2026-07-28T00:00:00.000Z' });
    lib.upsertPaper({
      id: 'paper_arxiv_2607_21051',
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2607.21051', url: 'https://arxiv.org/abs/2607.21051' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2607.21051', url: 'https://arxiv.org/abs/2607.21051' }],
      identifiers: { arxiv: '2607.21051' },
      tags: [],
      title: 'Sample-Efficient Learning from Agent Experience',
    });
    lib.upsertLink({
      paperId: 'paper_arxiv_2607_21051',
      surfaceType: 'topic',
      surfaceId: 'agentic-model-training',
      relation: 'candidate',
      rationale: 'seed',
    });
    expect(pickLinkedLibraryCandidate({
      workspaceRoot: root,
      topicPath: 'agentic-model-training',
    })).toBe('arxiv:2607.21051');
  });

  it('skips papers already integrated into the topic', () => {
    const lib = new PaperLibrary(root, { now: () => '2026-07-28T00:00:00.000Z' });
    lib.upsertPaper({
      id: 'paper_arxiv_2607_21051',
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2607.21051', url: 'https://arxiv.org/abs/2607.21051' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2607.21051', url: 'https://arxiv.org/abs/2607.21051' }],
      identifiers: { arxiv: '2607.21051' },
      tags: [],
    });
    lib.upsertLink({
      paperId: 'paper_arxiv_2607_21051',
      surfaceType: 'topic',
      surfaceId: 'agentic-model-training',
      relation: 'integrated',
    });
    lib.upsertIntegration({
      paperId: 'paper_arxiv_2607_21051',
      topicId: 'agentic-model-training',
      notePath: 'notes/active/01_x.md',
      zone: 'active',
      integratedAt: '2026-07-28T00:00:00.000Z',
    });
    expect(pickLinkedLibraryCandidate({
      workspaceRoot: root,
      topicPath: 'agentic-model-training',
    })).toBeNull();
  });
});
