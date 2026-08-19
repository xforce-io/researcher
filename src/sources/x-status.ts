import type { DocType } from '../library/doc-type.js';

const FETCH_TIMEOUT_MS = 15_000;
const STATUS_RE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/([^/?#]+)\/status\/(\d+)/i;

export interface XStatusRef {
  statusId: string;
  handle: string;
}

export interface XStatusMaterial {
  title: string;
  text: string;
  contentType: string;
  docType: DocType;
  url: string;
}

export function parseXStatusUrl(url: string): XStatusRef | null {
  const m = STATUS_RE.exec(url.trim());
  if (!m) return null;
  return { handle: m[1], statusId: m[2] };
}

export async function fetchXStatusMaterial(url: string, docType: DocType): Promise<XStatusMaterial> {
  const ref = parseXStatusUrl(url);
  if (!ref) throw new Error(`not an X status URL: ${url}`);

  let lastErr: unknown;
  try {
    const json = await getJson(`https://api.fxtwitter.com/status/${ref.statusId}`);
    return materialFromFxtwitter(json, url, docType);
  } catch (err) {
    lastErr = err;
  }
  try {
    const json = await getJson(
      `https://cdn.syndication.twimg.com/tweet-result?id=${ref.statusId}&token=0`,
    );
    return materialFromSyndication(json, url, docType);
  } catch (err) {
    const a = lastErr instanceof Error ? lastErr.message : String(lastErr);
    const b = err instanceof Error ? err.message : String(err);
    throw new Error(`url fetch failed: X status ${ref.statusId}: ${a}; syndication: ${b}`);
  }
}

export function materialFromFxtwitter(raw: unknown, url: string, docType: DocType): XStatusMaterial {
  const tweet = asRecord(asRecord(raw).tweet);
  const handle = String(asRecord(tweet.author).screen_name ?? parseXStatusUrl(url)?.handle ?? 'unknown');
  return finishMaterial({
    url,
    docType,
    handle,
    tweetText: pickTweetText(tweet),
    article: tweet.article ? asRecord(tweet.article) : undefined,
  });
}

export function materialFromSyndication(raw: unknown, url: string, docType: DocType): XStatusMaterial {
  const row = asRecord(raw);
  const handle = String(asRecord(row.user).screen_name ?? parseXStatusUrl(url)?.handle ?? 'unknown');
  return finishMaterial({
    url,
    docType,
    handle,
    tweetText: typeof row.text === 'string' ? row.text : '',
    article: row.article ? asRecord(row.article) : undefined,
  });
}

function finishMaterial(opts: {
  url: string;
  docType: DocType;
  handle: string;
  tweetText: string;
  article: Record<string, unknown> | undefined;
}): XStatusMaterial {
  const folded = foldArticle(opts.article);
  const tweetText = opts.tweetText.trim();
  const articleOwnsBody = Boolean(folded) && (tweetText.length === 0 || /^https?:\/\/\S+$/i.test(tweetText));
  const text = articleOwnsBody && folded
    ? folded.text
    : folded
      ? `${tweetText}\n\n${folded.text}`
      : tweetText;
  if (!text.trim()) {
    throw new Error(`url fetch produced empty text for ${opts.url}`);
  }
  const title = folded?.title || tweetText.split('\n')[0]?.slice(0, 120) || `@${opts.handle}`;
  return {
    title,
    text,
    contentType: 'text/plain',
    docType: opts.docType,
    url: opts.url,
  };
}

function foldArticle(article: Record<string, unknown> | undefined): { title: string; text: string } | undefined {
  if (!article) return undefined;
  const title = typeof article.title === 'string' ? article.title.trim() : '';
  const content = asRecord(article.content);
  const blocks = Array.isArray(content.blocks) ? content.blocks : [];
  const paras: string[] = [];
  for (const b of blocks) {
    const t = asRecord(b).text;
    if (typeof t === 'string' && t.trim()) paras.push(t.trim());
  }
  const preview = typeof article.preview_text === 'string' ? article.preview_text.trim() : '';
  const body = paras.length > 0 ? paras.join('\n\n') : preview;
  if (!title && !body) return undefined;
  const text = title && body ? `# ${title}\n\n${body}` : title ? `# ${title}` : body;
  return { title: title || 'X Article', text };
}

function pickTweetText(tweet: Record<string, unknown>): string {
  if (typeof tweet.text === 'string' && tweet.text.trim()) return tweet.text;
  const raw = asRecord(tweet.raw_text).text;
  return typeof raw === 'string' ? raw : '';
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
