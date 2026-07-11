# 89 · Paper-local Notes on Library Deep-read Page

Issue: https://github.com/xforce-io/researcher/issues/89  
PR: https://github.com/xforce-io/researcher/pull/90

## Product model (dual-track)

Library deep-read and Topic work are separate jobs:

| Track | Job | Durable output |
|--|--|--|
| **Library · machine** | Neutral deep-read of a source | `reads/<readId>.md` artifact |
| **Library · human** | Attention / clarification on that paper | **Notes** (this design) |
| **Topic** | Thesis-driven synthesis | topic notes + landscape + report |
| **Join** | link / integrate | later; not this issue |

Dialog/chat is only a *means* to distill attention. The product unit is **notes**, not threads. No Ask/dialog in v1.

## Persistence

Ledger (workspace Library root):

```
.researcher-workspace/library/notes.jsonl
```

Each row:

```ts
{
  id: string;
  paperId: string;
  body: string;           // Markdown
  kind: 'note' | 'clarification' | 'caveat' | 'idea' | 'question';
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}
```

Rules:

- Notes are paper-local and thesis-neutral.
- Force re-read of the machine artifact **must not** wipe notes.
- Deleting an unlinked paper removes its notes with the paper ledger rows.

## Web UI (`/library/p/:paperId`)

Single **document surface** (not list-card + artifact stack):

1. Breadcrumb: `← Library / Paper` (wayfinding; secondary chrome).
2. Page head: paper title (sole H1) + **Notes** primary jump + status badge.
3. Reader: aligned identity `.fm` table (authors / arxiv / source / pdf / tags / status) then deep-read body (Frame → Claims…); system frontmatter (`paper_id`, `read_id`, `kind`, …) hidden.
4. Notes panel (`#notes`): add (Markdown), pin/unpin, delete.
5. Inspector (right): Deep read / Link / Delete / Relations — actions, not a second identity block.

Button language matches the rest of the console:

- **Primary** — Notes jump, Add note, Deep read, Add paper
- **Secondary** — breadcrumb back, Link topic, Pin
- **Badge** — read status (not a button)

## HTTP

`POST /library/note` with form fields:

| action | fields |
|--|--|
| `create` | `paperId`, `body`, `kind?`, `pinned?` |
| `pin` / `unpin` | `paperId`, `noteId` |
| `delete` | `paperId`, `noteId` |

Redirects to `/library/p/:paperId#notes`.

## Out of scope

- In-app Ask / import browser sidebar chat
- Merging notes into the machine read artifact
- Topic-aware notes or auto-integrate
- Home “papers with notes” attention

## Related

- #65 workspace / Library IA (paper detail as first-class route)
- #69 runner-owned Library read artifacts
- #85 / #86 Workspace Home decision surface
- #87 dual-track Library read prompt quality
