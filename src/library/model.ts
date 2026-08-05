import type { DocType } from './doc-type.js';

export type { DocType } from './doc-type.js';
export type SourceKind = 'arxiv' | 'url';

export interface SourceRef {
  kind: SourceKind;
  id: string;
  url?: string;
}

export interface Paper {
  id: string;
  canonicalSource: SourceRef;
  sources: SourceRef[];
  title?: string;
  authors?: string[];
  abstract?: string;
  identifiers: {
    arxiv?: string;
    url?: string;
    doi?: string;
  };
  tags: string[];
  /** Content shape for deep-read templates. Absent ⇒ treat as paper for back-compat. */
  docType?: DocType;
  createdAt: string;
  updatedAt: string;
}

export type PaperReadStatus = 'queued' | 'reading' | 'read' | 'failed';

export interface PaperRead {
  id: string;
  paperId: string;
  status: PaperReadStatus;
  artifactPath?: string;
  /** Terminal failure reason when status is failed (timeout, API error, orphan reclaim, …). */
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

/** Human attention layer on a Library paper (not the machine deep-read artifact). */
export type PaperNoteKind = 'note' | 'clarification' | 'caveat' | 'idea' | 'question';

export interface PaperNote {
  id: string;
  paperId: string;
  body: string;
  kind: PaperNoteKind;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SurfaceType = 'topic' | 'tag-graph' | 'concept-map' | 'collection' | 'board';

export interface PaperSurfaceLink {
  paperId: string;
  surfaceType: SurfaceType;
  surfaceId: string;
  /** Optional human context for why this paper is linked to this surface. */
  rationale?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TopicIntegration {
  paperId: string;
  topicId: string;
  notePath?: string;
  zone?: 'active' | 'buffer' | 'history';
  integratedAt: string;
  summary?: string;
  landscapeImpact?: string;
  reportImpact?: string;
}
