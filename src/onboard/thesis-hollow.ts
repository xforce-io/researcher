/**
 * Instructional anchors that remain after a weak onboard which only
 * normalizes punctuation / drops Design Context but never writes a real thesis.
 */
const THESIS_HOLLOW_ANCHORS = [
  'Write one paragraph per major claim',
  'TODO: revisit after first few papers',
  'What counts as a good paper here?',
  'What do you intentionally reject?',
  'Pointers to existing notes that exemplify good or bad inclusion decisions',
];

/**
 * True when thesis markdown is still instructional scaffold (template copy or
 * weak onboard that only dropped Design Context / added TODOs). Shared by
 * soul-ready UI gate and Complete setup generate/apply so hollow drafts cannot
 * be written as "done".
 */
export function isThesisBodyHollow(body: string): boolean {
  if (!body.trim()) return true;
  // Count instructional anchors; one leftover example phrase is fine, several mean hollow.
  let hits = 0;
  for (const a of THESIS_HOLLOW_ANCHORS) {
    if (body.includes(a)) hits++;
  }
  return hits >= 2;
}
