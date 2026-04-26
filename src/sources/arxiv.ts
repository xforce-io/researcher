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
  const absUrl = arxivAbsUrl(canonicalId);
  const html = await (await fetch(absUrl)).text();
  const title = (/<meta name="citation_title" content="([^"]+)"/.exec(html)?.[1] ?? '').trim();
  const abstract = (/<meta name="citation_abstract" content="([^"]+)"/.exec(html)?.[1] ?? '').trim();
  const authors = [...html.matchAll(/<meta name="citation_author" content="([^"]+)"/g)].map((m) => m[1]);
  if (!title) throw new Error(`could not parse title from ${absUrl}`);
  return {
    id: canonicalId,
    title,
    authors,
    abstract,
    abs_url: absUrl,
    pdf_url: arxivPdfUrl(canonicalId),
  };
}
