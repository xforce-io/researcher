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
 * Body to embed under a Topic integration note's `## Library read`.
 * Drops system frontmatter and a leading H1 that repeats the paper title.
 */
export function libraryReadEmbedBody(artifact: string, paperTitle: string): string {
  const trimmed = artifact.trim();
  const { body } = splitFrontmatter(trimmed);
  return stripDuplicateLeadingH1(body, paperTitle).trim();
}

/** True when fm looks like a library-read system block (not a human note masthead). */
export function isLibraryReadFrontmatter(fm: Record<string, string>): boolean {
  const kind = unquoteFm(fm.kind ?? '');
  if (kind === 'library-read' || kind === 'legacy-topic-read') return true;
  return Boolean(fm.paper_id || fm.read_id || fm.doc_type || fm.source_kind);
}

