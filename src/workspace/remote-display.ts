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
    return remote.replace(/^[^/@\s]+@([^:\s]+:)/, '$1');
  }
}
