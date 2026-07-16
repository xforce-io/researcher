# 98 · Essence replaces Brief (Library deep-read)

Issue: https://github.com/xforce-io/researcher/issues/98

## Decision

New Library deep-read artifacts use **`## Essence`** instead of **`## Brief`**.

- **Frame** — one-line hook (unchanged)
- **Essence** — only first-screen explanation: **问题 / 做法 / 证据 / 边界**
- Claims…Takeaway — unchanged evidence card
- Historical `## Brief` remains readable via display rewrite to the Essence slot (`displayLibraryReadMarkdown`)

Thesis-neutral dual-track (#89) is unchanged: Essence must not coach workspace topics.

## Code

| Piece | Role |
|-------|------|
| `prompts/stage-library-read.md` | Paper prompt structure + quality bar |
| `prompts/stage-library-read-doc.md` | Doc variant aligned |
| `src/web/library-read-sections.ts` | Section contract + Brief→Essence display helper |
| `src/web/views.ts` | Applies display helper in paper detail reader |

## Non-goals

- Topic-link suggestions (#97)
- Merging pinned notes into the machine artifact
- Bulk rewrite without re-read
