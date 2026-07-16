/**
 * Sanitize HTML produced by marked for researcher serve (#77).
 * Note/report/library-read bodies may contain agent or external content; strip
 * executable vectors while keeping ordinary formatting tags.
 *
 * Intentional non-parser approach: strip known XSS vectors. Not a full HTML
 * firewall — suitable for localhost serve; upgrade if serve is ever public.
 */

/** Closed or unclosed script: from <script…> through </script> or end of string. */
const SCRIPT_BLOCK_RE = /<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi;
/** Stray closing tags left after partial removals. */
const SCRIPT_CLOSE_RE = /<\/script\s*>/gi;
/** Any remaining script open tag fragments. */
const SCRIPT_OPEN_RE = /<script\b[^>]*>?/gi;

const STYLE_BLOCK_RE = /<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi;
const STYLE_CLOSE_RE = /<\/style\s*>/gi;
const STYLE_OPEN_RE = /<style\b[^>]*>?/gi;

const EVENT_HANDLER_RE = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

/** href="javascript:…" / href='javascript:…' (any case, optional whitespace). */
const JS_URL_QUOTED_RE =
  /(\s(?:href|src|xlink:href|action|formaction)\s*=\s*)(['"])\s*javascript\s*:[^'"]*\2/gi;
/** href=javascript:alert(1) unquoted. */
const JS_URL_UNQUOTED_RE =
  /(\s(?:href|src|xlink:href|action|formaction)\s*=\s*)javascript\s*:[^\s>]*/gi;

const DANGEROUS_TAG_RE = /<\/?(?:iframe|object|embed|link|meta|base|form)\b[^>]*>/gi;

export function sanitizeHtml(html: string): string {
  if (!html) return html;
  let out = html;
  out = out.replace(SCRIPT_BLOCK_RE, '');
  out = out.replace(SCRIPT_CLOSE_RE, '');
  out = out.replace(SCRIPT_OPEN_RE, '');
  out = out.replace(STYLE_BLOCK_RE, '');
  out = out.replace(STYLE_CLOSE_RE, '');
  out = out.replace(STYLE_OPEN_RE, '');
  out = out.replace(EVENT_HANDLER_RE, '');
  out = out.replace(JS_URL_QUOTED_RE, '$1$2#$2');
  out = out.replace(JS_URL_UNQUOTED_RE, '$1#');
  out = out.replace(DANGEROUS_TAG_RE, '');
  return out;
}
