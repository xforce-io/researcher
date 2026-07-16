/**
 * Sanitize HTML produced by marked for researcher serve (#77).
 * Note/report/library-read bodies may contain agent or external content; strip
 * executable vectors while keeping ordinary formatting tags.
 */

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const EVENT_HANDLER_RE = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL_RE = /(\s(?:href|src|action)\s*=\s*)(['"])\s*javascript:[^'"]*\2/gi;
const DANGEROUS_TAG_RE = /<\/?(?:iframe|object|embed|link|meta|base|form)\b[^>]*>/gi;

export function sanitizeHtml(html: string): string {
  if (!html) return html;
  let out = html;
  out = out.replace(SCRIPT_RE, '');
  out = out.replace(STYLE_RE, '');
  out = out.replace(EVENT_HANDLER_RE, '');
  out = out.replace(JS_URL_RE, '$1$2#$2');
  out = out.replace(DANGEROUS_TAG_RE, '');
  return out;
}
