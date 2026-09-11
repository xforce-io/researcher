import type { DocType, LibraryDocType } from './doc-type.js';

export type { DocType, LibraryDocType } from './doc-type.js';
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
  mutationId?: string;
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

export interface VideoMedia {
  filename: string;
  sha256: string;
  bytes: number;
  contentType: 'video/mp4' | 'video/webm';
}

export interface VideoCue {
  id: number;
  start: number;
  end: number;
  text: string;
}

export type VideoAnalysisStatus = 'queued' | 'running' | 'done' | 'failed';

export interface VideoAnalysis {
  id: string;
  documentId: string;
  status: VideoAnalysisStatus;
  createdAt: string;
  updatedAt: string;
  mutationId?: string;
  lastError?: string;
  noSpeech?: boolean;
  cues?: VideoCue[];
}

export interface LibraryDocument {
  id: string;
  docType: LibraryDocType;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  revision: number;
  lastMutationId?: string;
  body: string;
  canonicalSource?: SourceRef;
  sources: SourceRef[];
  identifiers: Paper['identifiers'];
  authors?: string[];
  abstract?: string;
  media?: VideoMedia;
}

export type LibraryStatusFilter = 'all' | 'unlinked' | 'unread' | 'read' | 'linked' | 'integrated';

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
