# Issue 57: Workspace Paper Library model and capabilities

Issue: https://github.com/xforce-io/researcher/issues/57

## Decision

Adopt a Library-first model: `Paper` is a workspace-level object. A topic is one possible surface that can link to or integrate a paper, but it does not own the paper.

This design is model/capability only. Web page design belongs to #56 after this model is settled.

## Goals

- Introduce canonical workspace paper identity and de-duplication.
- Store paper metadata, paper-level tags, and deep-read artifacts outside any single topic.
- Model relations from papers to surfaces such as topics, future tag graphs, concept maps, collections, or boards.
- Model topic integration as relation/capability state, not intrinsic paper state.
- Provide a compatibility path from existing topic-local `notes/pending/` artifacts.
- Add core APIs and CLI-level capabilities that can be tested end to end without Web UI.

## Non-goals

- No Web page design or rendering changes.
- No tag graph UI.
- No topic integration UI.
- No automatic replacement of existing topic `report.md` / `landscape` flows.
- No migration that moves existing files in this issue.

## Model

```ts
type SourceKind = 'arxiv' | 'url';

interface SourceRef {
  kind: SourceKind;
  id: string;
  url?: string;
}

interface Paper {
  id: string;
  canonicalSource: SourceRef;
  sources: SourceRef[];
  title?: string;
  authors?: string[];
  abstract?: string;
  identifiers: { arxiv?: string; url?: string; doi?: string };
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface PaperRead {
  id: string;
  paperId: string;
  status: 'queued' | 'reading' | 'read' | 'failed';
  artifactPath?: string;
  createdAt: string;
  updatedAt: string;
}

type SurfaceType = 'topic' | 'tag-graph' | 'concept-map' | 'collection' | 'board';
type PaperRelation = 'candidate' | 'relevant' | 'integrated' | 'rejected' | 'archived';

interface PaperSurfaceLink {
  paperId: string;
  surfaceType: SurfaceType;
  surfaceId: string;
  relation: PaperRelation;
  rationale?: string;
  createdAt: string;
  updatedAt: string;
}

interface TopicIntegration {
  paperId: string;
  topicId: string;
  notePath?: string;
  zone?: 'active' | 'buffer' | 'history';
  integratedAt: string;
  summary?: string;
  landscapeImpact?: string;
  reportImpact?: string;
}
```

## Storage

Use a workspace-root state directory:

```text
.researcher-workspace/
  library/
    papers.jsonl
    reads.jsonl
    links.jsonl
    integrations.jsonl
    papers/
      paper_arxiv_2401_00001/
        read.md
        source.json
        assets/
```

Topic repos remain focused on topic synthesis.

## Core Capabilities

1. `PaperLibrary` store API:
   - create/load workspace library directory;
   - upsert/get/list papers;
   - upsert/get/list reads;
   - upsert/list paper-surface links;
   - upsert/list topic integrations.
2. Canonical ID helpers:
   - arXiv inputs produce stable `paper_arxiv_<id>` ids independent of version suffix;
   - URL inputs produce deterministic `paper_url_<hash>` ids from canonical URL.
3. CLI capability:
   - `researcher library add <input>` creates or updates a paper record without requiring a topic;
   - `researcher library list` lists library papers;
   - `researcher library link <paper-id> --topic <topic-id> [--relation candidate|relevant|...]` creates a paper-to-topic relation;
   - `researcher library integrate <paper-id> --topic <topic-id> [--note <path>] [--zone active|buffer|history]` records integration state and marks the topic link as `integrated`.
4. Compatibility helper:
   - discover legacy topic-local `notes/pending/NN_slug.md` as import candidates without moving them.

## Acceptance Criteria

- Workspace library data model is implemented and tested.
- `researcher library add/list/link/integrate` works without a topic `.researcher/` directory.
- Adding the same arXiv paper twice is idempotent.
- Linking a paper to a topic records relation state without changing topic synthesis artifacts.
- Recording a topic integration updates library state without changing topic synthesis artifacts.
- Legacy pending notes can be discovered as import candidates without mutation.
- No Web UI changes are included.
