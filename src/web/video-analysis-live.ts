/** In-process live video-analysis jobs for this serve. */

export class VideoAnalysisLiveSet {
  private readonly analysisIds = new Set<string>();
  private readonly documentToAnalysis = new Map<string, string>();

  add(documentId: string, analysisId: string): void {
    const prev = this.documentToAnalysis.get(documentId);
    if (prev) this.analysisIds.delete(prev);
    this.documentToAnalysis.set(documentId, analysisId);
    this.analysisIds.add(analysisId);
  }

  delete(analysisId: string): void {
    if (!this.analysisIds.delete(analysisId)) return;
    for (const [doc, id] of this.documentToAnalysis) {
      if (id === analysisId) this.documentToAnalysis.delete(doc);
    }
  }

  has(analysisId: string): boolean {
    return this.analysisIds.has(analysisId);
  }

  forDocument(documentId: string): string | undefined {
    return this.documentToAnalysis.get(documentId);
  }
}
