/**
 * Generic leading YAML frontmatter helpers shared by Web render and pipeline
 * note writers. Line-oriented (not full YAML): values kept as raw strings.
 */

export function unquoteFm(s: string): string {
  return s.trim().replace(/^["']|["']$/g, '').trim();
}

/** Split a leading `---` … `---` block. fm=null when no fence. */
export function splitFrontmatter(md: string): { fm: Record<string, string> | null; body: string } {
  if (!md.startsWith('---')) return { fm: null, body: md };
  const end = md.indexOf('\n---', 3);
  if (end < 0) return { fm: null, body: md };
  const fm: Record<string, string> = {};
  for (const line of md.slice(3, end).split('\n')) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (m) fm[m[1]] = m[2].trim();
  }
  return { fm, body: md.slice(end + 4).replace(/^\s*\n/, '') };
}

/** Drop a leading `# title` when it matches `title` (whitespace-normalized). */
export function stripDuplicateLeadingH1(body: string, title: string): string {
  if (!title) return body;
  const m = /^#[ \t]+([^\n]+)\n?/.exec(body);
  if (!m) return body;
  const norm = (s: string) => unquoteFm(s).replace(/\s+/g, ' ').trim();
  return norm(m[1]) === norm(title) ? body.slice(m[0].length).replace(/^\s*\n/, '') : body;
}

/**
 * Human-useful identity keys retained when embedding a library-read into a
 * Topic integration note. System keys (paper_id / read_id / kind: library-read /
 * doc_type / source_kind / tags) are never copied.
 */
const IDENTITY_FM_KEYS = ['authors', 'source_id', 'source_url', 'pdf_url'] as const;

/** Compact identity FM from a full library-read fence; null when nothing useful. */
export function compactLibraryReadIdentityFm(
  fm: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!fm) return null;
  const out: Record<string, string> = { kind: 'library-read-identity' };
  let useful = false;
  for (const key of IDENTITY_FM_KEYS) {
    const raw = fm[key]?.trim();
    if (!raw) continue;
    out[key] = raw;
    useful = true;
  }
  return useful ? out : null;
}

/** Serialize a compact identity fence (trailing newline after closing ---). */
export function serializeLibraryReadIdentityFm(fm: Record<string, string>): string {
  const lines = ['---', `kind: ${unquoteFm(fm.kind ?? 'library-read-identity') || 'library-read-identity'}`];
  for (const key of IDENTITY_FM_KEYS) {
    if (fm[key] != null && String(fm[key]).trim() !== '') lines.push(`${key}: ${fm[key]}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

/**
 * Body to embed under a Topic integration note's `## Library read`.
 * Keeps a compact human-useful identity fence; drops system frontmatter and a
 * leading H1 that repeats the paper title.
 */
export function libraryReadEmbedBody(artifact: string, paperTitle: string): string {
  const trimmed = artifact.trim();
  const { fm, body } = splitFrontmatter(trimmed);
  const reading = stripDuplicateLeadingH1(body, paperTitle).trim();
  const identity = compactLibraryReadIdentityFm(fm);
  if (!identity) return reading;
  return `${serializeLibraryReadIdentityFm(identity)}${reading}`;
}

/** True when fm looks like a library-read system or compact-identity block. */
export function isLibraryReadFrontmatter(fm: Record<string, string>): boolean {
  const kind = unquoteFm(fm.kind ?? '');
  if (kind === 'library-read' || kind === 'legacy-topic-read' || kind === 'library-read-identity') {
    return true;
  }
  return Boolean(fm.paper_id || fm.read_id || fm.doc_type || fm.source_kind);
}

