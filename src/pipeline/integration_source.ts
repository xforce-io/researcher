import { isNoteDocType, isVideoDocType } from '../library/doc-type.js';
import type { LibraryDocument, VideoCue } from '../library/model.js';
import type { PaperLibrary } from '../library/store.js';

/**
 * Integration source (#197): the content a linked document contributes when a
 * topic Run integrates it. External material uses its deep-read artifact, a
 * standalone note uses its own body, a video uses its current cues.
 */
export type IntegrationSourceKind = 'read' | 'note-body' | 'cues';

export type IntegrationSourceState =
  | { ready: true; kind: IntegrationSourceKind }
  | { ready: false; reason: string };

/**
 * Whether this document can be integrated right now. Used both by the queue
 * precheck and by the read stage, so the two never disagree.
 */
export function integrationSourceState(lib: PaperLibrary, doc: LibraryDocument): IntegrationSourceState {
  if (isVideoDocType(doc.docType)) {
    const product = lib.currentCues(doc.id);
    if (!product) return { ready: false, reason: 'no transcript yet — analyze the video first' };
    if (product.noSpeech || product.cues.length === 0) {
      return { ready: false, reason: 'transcript is empty (no speech detected)' };
    }
    return { ready: true, kind: 'cues' };
  }
  if (isNoteDocType(doc.docType)) {
    if (!doc.body.trim()) return { ready: false, reason: 'note body is empty' };
    return { ready: true, kind: 'note-body' };
  }
  if (!doc.canonicalSource) return { ready: false, reason: 'no canonical source to deep-read' };
  return { ready: true, kind: 'read' };
}

/** `m:ss` / `h:mm:ss`, same clock the video workbench shows. */
export function formatCueClock(seconds: number): string {
  const t = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Transcript as topic-note body. Timestamps are kept: they are the only thing a
 * cue carries beyond plain prose, and they let a reader seek back to the video.
 */
export function cuesIntegrationBody(cues: VideoCue[]): string {
  return cues
    .map((c) => {
      const head = `[${formatCueClock(c.start)}] ${c.text}`;
      return c.zh ? `${head}\n  ${c.zh}` : head;
    })
    .join('\n');
}
