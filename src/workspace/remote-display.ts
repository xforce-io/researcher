export function sanitizeRemoteForDisplay(remote: string): string {
  try {
    const hadPathname = /^[a-z][a-z\d+.-]*:\/\/[^/?#]+\//i.test(remote);
    const url = new URL(remote);
    url.username = '';
    url.password = '';
    const display = url.toString();
    return hadPathname
      ? display
      : display.replace(/^([a-z][a-z\d+.-]*:\/\/[^/?#]+)\/(?=[?#]|$)/i, '$1');
  } catch {
    // scp-like: user@host:path  or user@host/path
    return remote
      .replace(/^[^/@\s]+@([^:\s]+:)/, '$1')
      .replace(/^[^/@\s]+@([^/\s]+\/)/, '$1');
  }
}

/** Strip remote userinfo/token material from free-form git or error text. */
export function sanitizeErrorText(text: string, knownRemote?: string): string {
  let out = text;
  if (knownRemote) {
    const display = sanitizeRemoteForDisplay(knownRemote);
    if (display !== knownRemote) out = out.split(knownRemote).join(display);
  }
  const urlMatch = out.match(/https?:\/\/[^\s]+|git@[^:\s]+:[^\s]+/i);
  if (urlMatch) {
    const redactedUrl = sanitizeRemoteForDisplay(urlMatch[0]);
    if (redactedUrl !== urlMatch[0]) out = out.split(urlMatch[0]).join(redactedUrl);
  }
  return out
    .replace(/https?:\/\/[^/\s:@]+:[^/\s@]+@/gi, (match) =>
      match.startsWith('https') ? 'https://' : 'http://',
    )
    .replace(/https?:\/\/[^/\s:@]+@/gi, (match) =>
      match.startsWith('https') ? 'https://' : 'http://',
    )
    .replace(/\b[^/\s:@]+@([^:\s]+:)/g, '$1')
    .replace(/\b[^/\s:@]+@([^/\s]+\.[^/\s]+)/g, '$1');
}
