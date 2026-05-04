const URL_PREFIX = 'url:';

export function canonicalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('canonicalizeUrl: empty input');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`canonicalizeUrl: not a valid URL: ${input}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`canonicalizeUrl: only http(s) URLs are accepted, got ${parsed.protocol}`);
  }
  // URL parser already lowercases host; strip fragment; keep path + query as-is.
  parsed.hash = '';
  return `${URL_PREFIX}${parsed.toString()}`;
}

export function urlPathSlug(canonicalId: string): string {
  if (!canonicalId.startsWith(URL_PREFIX)) {
    throw new Error(`urlPathSlug: expected url:-prefixed id, got ${canonicalId}`);
  }
  const bare = canonicalId.slice(URL_PREFIX.length);
  const u = new URL(bare);
  const path = u.pathname.replace(/\/+$/, ''); // strip trailing slashes
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || last === 'index') return u.hostname;
  return last;
}
