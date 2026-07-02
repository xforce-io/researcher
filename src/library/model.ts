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
  createdAt: string;
  updatedAt: string;
}

export type PaperReadStatus = 'queued' | 'reading' | 'read' | 'failed';

export interface PaperRead {
  id: string;
  paperId: string;
  status: PaperReadStatus;
  artifactPath?: string;
  createdAt: string;
  updatedAt: string;
}

export type SurfaceType = 'topic' | 'tag-graph' | 'concept-map' | 'collection' | 'board';
export type PaperRelation = 'candidate' | 'relevant' | 'integrated' | 'rejected' | 'archived';

export interface PaperSurfaceLink {
  paperId: string;
  surfaceType: SurfaceType;
  surfaceId: string;
  relation: PaperRelation;
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
