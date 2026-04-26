const ID_RE = /(\d{4}\.\d{4,5})(?:v\d+)?/;

export function canonicalizeArxivId(input: string): string {
  const m = ID_RE.exec(input);
  if (!m) throw new Error(`not an arxiv id: ${input}`);
  return `arxiv:${m[1]}`;
}

export function arxivAbsUrl(canonicalId: string): string {
  const id = canonicalId.replace(/^arxiv:/, '');
  return `https://arxiv.org/abs/${id}`;
}

export function arxivPdfUrl(canonicalId: string): string {
  const id = canonicalId.replace(/^arxiv:/, '');
  return `https://arxiv.org/pdf/${id}`;
}

export interface ArxivMetadata {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  abs_url: string;
  pdf_url: string;
}

export async function fetchArxivMetadata(canonicalId: string): Promise<ArxivMetadata> {
  const bareId = canonicalId.replace(/^arxiv:/, '');
  const apiUrl = `https://export.arxiv.org/api/query?id_list=${bareId}`;
  const res = await fetchWithRetry(apiUrl);
  if (!res.ok) throw new Error(`arxiv api ${res.status} for ${bareId}`);
  const xml = await res.text();
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
  if (!entry) throw new Error(`no entry for ${bareId} in arxiv api response`);
  const title = decodeXml(/<title>([\s\S]*?)<\/title>/.exec(entry)?.[1] ?? '');
  const abstract = decodeXml(/<summary>([\s\S]*?)<\/summary>/.exec(entry)?.[1] ?? '');
  const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
    .map((m) => decodeXml(m[1]));
  if (!title) throw new Error(`empty title for ${bareId} in arxiv api response`);
  return {
    id: canonicalId,
    title,
    authors,
    abstract,
    abs_url: arxivAbsUrl(canonicalId),
    pdf_url: arxivPdfUrl(canonicalId),
  };
}

async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let last: Response | undefined;
  for (let i = 0; i < attempts; i++) {
    last = await fetch(url);
    if (last.ok) return last;
    if (last.status < 500) return last; // 4xx — don't retry, the id is wrong
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1))); // 0.5s, 1s
  }
  return last as Response;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
