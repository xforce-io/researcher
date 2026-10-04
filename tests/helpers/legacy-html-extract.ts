/** Quarantined first-<article> regex. Production no longer uses this. */
export function extractHtmlMainText(html: string): { title: string; text: string } {
  let title = '';
  const tm = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (tm) title = decodeEntities(stripTags(tm[1])).replace(/\s+/g, ' ').trim();

  const body = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const main =
    /<article\b[\s\S]*?<\/article>/i.exec(body)?.[0] ??
    /<main\b[\s\S]*?<\/main>/i.exec(body)?.[0] ??
    /<body\b[\s\S]*?<\/body>/i.exec(body)?.[0] ??
    body;

  const text = decodeEntities(
    main
      .replace(/<\/(p|div|h[1-6]|li|tr|section|header|footer|article|main|blockquote|pre)[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?[^>]+>/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
  );

  return { title, text };
}

function stripTags(s: string): string {
  return s.replace(/<\/?[^>]+>/g, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
