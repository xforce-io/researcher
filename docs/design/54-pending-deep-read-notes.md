# Issue 54: Pending deep-read notes with note-level tags

Issue: https://github.com/xforce-io/researcher/issues/54
PR: https://github.com/xforce-io/researcher/pull/55

## Need

The current paper path writes every newly read paper directly into `notes/active/` and immediately runs synthesis/package through `researcher add`. In code, `read()` creates integrated notes by default, `Zone` only modeled integrated zones, and callers used one note listing for both allocation and synthesis context.

This leaves no durable state for a paper that has been deep-read but intentionally not integrated into the topic's landscape/report yet.

Add the smallest first-class pending state so a user can deep-read a paper, preserve the single-paper artifact with tags, and stop before synthesis. Keep existing `researcher add` and autonomous `researcher run` behavior end-to-end.

## Acceptance Criteria

1. The CLI exposes a read-only paper flow as `researcher read <input>`, where `<input>` accepts the same arXiv ID or http(s) URL forms currently accepted by `researcher add <input>`.
2. `researcher read <input>` runs bootstrap plus the existing read stage, writes exactly one new note under `notes/pending/NN_slug.md`, and does not run rebalance, synthesize, or package.
3. The pending note written by `researcher read <input>` is committed immediately so the topic working tree remains clean for later `researcher add` / `researcher run` invocations.
4. Pending notes are durable deep-read artifacts, not temporary drafts. Their frontmatter is serialized as:

```yaml
---
zone: pending
tags: []
pin: false
score: 0
dwell: 0
---
```

5. Note parsing and serialization support `zone: pending` and a `tags: string[]` field while preserving existing behavior for legacy notes without frontmatter.
6. Note indexing discovers pending notes and includes them in note-number allocation, so `NN_` values remain unique across `notes/pending`, `notes/active`, `notes/buffer`, `notes/history`, and legacy flat `notes/`.
7. Integrated synthesis contexts do not automatically treat pending notes as integrated evidence. Existing zone manifests for synthesize/rebalance/package should continue to cover only `active | buffer | history` unless a caller explicitly asks for pending notes.
8. `researcher add <input>` remains end-to-end and keeps its current user-visible behavior: bootstrap -> read into an integrated note -> synthesize -> package.
9. `researcher run` remains end-to-end and should not be changed to leave autonomous reads in pending state.
10. No web console or API display changes are included in this issue; the web console continues to count and list only integrated notes.
11. No explicit `researcher integrate` command is required in this issue; integration UX can be a follow-up.

## Approach

- Extend the note model in `src/state/zone.ts`:
  - Add `pending` to `Zone`.
  - Add `tags: string[]` to `NoteFrontmatter`.
  - Default legacy notes to the existing integrated behavior plus `tags: []`.
  - Serialize `tags` in frontmatter.
- Split note discovery in `src/state/note_index.ts` into explicit zone sets:
  - Integrated zones: `notes/active`, `notes/buffer`, `notes/history`.
  - Readable/all note zones: integrated zones plus `notes/pending` and legacy flat `notes/`.
  - Keep callers that feed synthesis/rebalance/package on integrated notes only.
  - Use all readable notes for `nextNoteNumber()` so pending and integrated notes share one numeric sequence.
- Parameterize `read(ctx)` so the destination zone can be either `active` or `pending`:
  - Default remains `active` for existing `researcher add` and `researcher run` callers.
  - The new read-only command passes `pending`.
  - The prompt receives the full relative target path.
  - The frontmatter fallback writes the destination zone and `tags: []`.
- Add `src/commands/read.ts` and wire `researcher read <input>` in `src/cli.ts`:
  - Reuse `canonicalizeAddInput` so input handling stays identical to `add`.
  - Run only bootstrap and read under the existing lock/run-dir pattern.
  - Commit only the new `notes/pending/NN_slug.md` file before returning, keeping the working tree clean for future end-to-end runs.
  - Do not mark the source as integrated through synthesis/package side effects.
- Keep web console discovery on integrated notes only by using `listIntegratedNotes()` in `src/web/discovery.ts`.
- Update `prompts/stage-read.md` so pending frontmatter is explicit when the target path is under `notes/pending/`.
- Add focused tests:
  - `researcher read` creates and commits `notes/pending/NN_slug.md` with `zone: pending` and `tags: []` and does not invoke synthesize/package.
  - `researcher add` remains end-to-end through existing coverage.
  - `parseNote`/`serializeNote` round-trip `pending` and `tags`.
  - `nextNoteNumber()` counts pending notes.
  - Integrated note listing used by synthesis/rebalance excludes pending notes by default.
  - Web discovery excludes pending notes from the displayed note list and dashboard note count.

## Known Follow-up

`researcher read <input>` intentionally does not append to `seen.jsonl` in this issue because the source has not been integrated. Re-reading the same source can therefore create multiple pending notes, and a later `researcher add <input>` will not know that the paper was previously deep-read. The explicit integration UX should resolve this by consuming pending notes and deciding how pending reads become integrated/seen entries.
