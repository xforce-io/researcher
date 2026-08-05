/**
 * Heuristic topic-link suggestions for Library paper detail (#97).
 * Pure: no I/O, no ledger writes. Callers fill the link form; only POST /library/link persists.
 */

export interface TopicSuggestProfile {
  topicId: string;
  /** project.yaml meta.topic_oneline */
  oneline?: string;
  /** thesis.md excerpt */
  thesisExcerpt?: string;
  /** optional charter / pillar blurb */
  charterExcerpt?: string;
}

export interface PaperSuggestSignals {
  title?: string;
  tags?: string[];
  /** Prefer pinned note bodies first. */
  notes?: string[];
  /** Essence + Takeaway (or Brief) from latest deep-read. */
  readExcerpt?: string;
}

export interface TopicLinkSuggestion {
  topicId: string;
  score: number;
  /** Short evidence-oriented why (not a slogan). */
  reason: string;
  /** Prefill for the rationale field; human may edit. */
  rationaleDraft: string;
}

export interface SuggestTopicLinksOptions {
  topK?: number;
  /** Minimum raw overlap score (default 2). */
  minScore?: number;
}

const DEFAULT_TOP_K = 3;
const DEFAULT_MIN_SCORE = 4;

/** Ultra-common tokens that flood Chinese thesis text — drop from scoring. */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were',
  'not', 'but', 'can', 'into', 'via', 'per', 'our', 'any', 'all', 'use', 'used',
  'using', 'than', 'then', 'when', 'what', 'how', 'why', 'its', 'also', 'more',
  'most', 'such', 'only', 'over', 'under', 'after', 'before', 'between',
  '论文', '本文', '研究', '方法', '模型', '系统', '能力', '问题', '结果', '数据',
  '通过', '以及', '或者', '一个', '没有', '可以', '需要', '进行', '不是', '而是',
  '如果', '因为', '所以', '这个', '那个', '他们', '我们', '已经', '仍然', '其中',
  'agent', 'agents', 'model', 'models', 'paper', 'task', 'tasks',
]);

/** Exported for tests — token set used by scoring. */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/[a-z][a-z0-9_-]{2,}/g)) {
    const t = m[0];
    if (!STOP.has(t)) out.add(t);
  }
  // CJK: prefer trigrams; keep bigrams only if not stop.
  for (const m of lower.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const s = m[0];
    if (s.length >= 3) {
      for (let i = 0; i < s.length - 2; i++) {
        const tri = s.slice(i, i + 3);
        if (!STOP.has(tri)) out.add(tri);
      }
    }
    for (let i = 0; i < s.length - 1; i++) {
      const bi = s.slice(i, i + 2);
      if (!STOP.has(bi)) out.add(bi);
    }
  }
  return out;
}

function paperTokenBag(signals: PaperSuggestSignals): Map<string, number> {
  const bag = new Map<string, number>();
  const add = (text: string | undefined, weight: number) => {
    if (!text) return;
    for (const t of tokenize(text)) {
      bag.set(t, (bag.get(t) ?? 0) + weight);
    }
  };
  add(signals.title, 2);
  for (const tag of signals.tags ?? []) add(tag, 2);
  for (const n of signals.notes ?? []) add(n, 3);
  add(signals.readExcerpt, 2);
  return bag;
}

function topicTokens(profile: TopicSuggestProfile): Set<string> {
  const parts = [
    profile.topicId.replace(/[-_/]/g, ' '),
    profile.topicId,
    profile.oneline ?? '',
    profile.thesisExcerpt ?? '',
    profile.charterExcerpt ?? '',
  ];
  return tokenize(parts.join('\n'));
}

function tokenStrength(token: string): number {
  // Prefer longer / technical tokens; downweight bare CJK bigrams.
  if (/^[a-z][a-z0-9_-]{4,}$/.test(token)) return 3;
  if (/^[a-z][a-z0-9_-]{2,}$/.test(token)) return 2;
  if (/^[\u4e00-\u9fff]{3,}$/.test(token)) return 2;
  if (/^[\u4e00-\u9fff]{2}$/.test(token)) return 0.5;
  return 1;
}

function topOverlapTokens(
  paperBag: Map<string, number>,
  topicToks: Set<string>,
  limit = 4,
): { token: string; weight: number }[] {
  const hits: { token: string; weight: number }[] = [];
  for (const t of topicToks) {
    const w = paperBag.get(t);
    if (!w) continue;
    hits.push({ token: t, weight: w * tokenStrength(t) });
  }
  hits.sort((a, b) => b.weight - a.weight || b.token.length - a.token.length || a.token.localeCompare(b.token));
  return hits.slice(0, limit);
}

function snippetAround(haystack: string, token: string, radius = 36): string | null {
  if (!haystack || !token) return null;
  const lower = haystack.toLowerCase();
  const idx = lower.indexOf(token.toLowerCase());
  if (idx < 0) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(haystack.length, idx + token.length + radius);
  let s = haystack.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) s = '…' + s;
  if (end < haystack.length) s = s + '…';
  return s;
}

function buildReason(
  topicId: string,
  hits: { token: string; weight: number }[],
  signals: PaperSuggestSignals,
): string {
  const corpus = [signals.title, ...(signals.notes ?? []), signals.readExcerpt]
    .filter(Boolean)
    .join('\n');
  for (const h of hits) {
    const snip = snippetAround(corpus, h.token);
    if (snip && snip.length >= 8) return snip;
  }
  if (hits.length > 0) {
    return `overlap with ${topicId}: ${hits.map((h) => h.token).slice(0, 3).join(', ')}`;
  }
  return `related to ${topicId}`;
}

/**
 * Rank topics for a paper. Pure — never writes links.
 * Returns at most topK suggestions with score ≥ minScore.
 */
export function suggestTopicLinks(
  paper: PaperSuggestSignals,
  topics: TopicSuggestProfile[],
  opts: SuggestTopicLinksOptions = {},
): TopicLinkSuggestion[] {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  const paperBag = paperTokenBag(paper);

  const scored: TopicLinkSuggestion[] = [];
  for (const topic of topics) {
    if (!topic.topicId) continue;
    const tToks = topicTokens(topic);
    const hits = topOverlapTokens(paperBag, tToks, 8);
    if (hits.length === 0) continue;
    // Require at least one moderately strong hit (avoid pure noise bigrams).
    const strong = hits.some((h) => tokenStrength(h.token) >= 2 || h.weight >= 3);
    if (!strong) continue;
    // Path slug boost: exact segment match in paper bag.
    let score = hits.reduce((s, h) => s + h.weight, 0);
    const pathParts = topic.topicId.toLowerCase().split(/[-_/]/).filter((p) => p.length >= 3);
    for (const p of pathParts) {
      if (paperBag.has(p)) score += 4;
    }
    if (score < minScore) continue;
    const reason = buildReason(topic.topicId, hits, paper);
    scored.push({
      topicId: topic.topicId,
      score,
      reason,
      rationaleDraft: reason,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.topicId.localeCompare(b.topicId));
  return scored.slice(0, topK);
}

/** Pull Essence / Brief / Takeaway from a library-read markdown body for signals. */
export function extractReadSuggestExcerpt(markdown: string): string {
  if (!markdown) return '';
  const parts: string[] = [];
  for (const name of ['Essence', 'Brief', 'Takeaway']) {
    // JS has no \Z; use end-of-string via (?=\\n## |$) without m-flag on the end.
    const re = new RegExp(`(?:^|\\n)## ${name}[ \\t]*\\n([\\s\\S]*?)(?=\\n## |$)`);
    const m = markdown.match(re);
    if (m) parts.push(m[1].trim());
  }
  // Frame lede as blockquote under H1
  const frame = markdown.match(/^> (.+)$/m);
  if (frame) parts.push(frame[1]);
  return parts.join('\n').slice(0, 12_000);
}
