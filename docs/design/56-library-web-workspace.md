# Issue 56: Library-first web workspace

Issue: https://github.com/xforce-io/researcher/issues/56

## Decision

Add a top-level Library page backed by the #57 workspace Paper Library model.

Papers are workspace-level objects. Topics are one possible surface that can link to or integrate papers. Topic pages should stay synthesis-focused and show related papers separately from integrated note zones.

## Goals

- Lower the cost of adding a paper from the Web UI.
- Reuse the same single-paper preview/read/tag/relation components across Library and Topic surfaces.
- Persist added papers through `PaperLibrary`, not Web-specific storage.
- Show topic-related papers without mixing them into `Active | Buffer | History` notes.
- Keep this issue focused on the usable paper intake and review surface, not full graph UI.

## Non-goals

- No full tag graph UI.
- No automatic synthesis or report updates.
- No migration that moves legacy `notes/pending/` files.
- No separate Web storage model.

## Information Architecture

- `/` remains the workspace dashboard.
- `/library` is the single paper-library workspace entry.
- `/library?paper=:paperId` selects one paper inside the Library workspace and shows its preview/read/tag/relation details in the same shell.
- `/library/p/:paperId` is only a compatibility deep link and redirects back to `/library?paper=:paperId`.
- `/t/:topic` remains the topic workspace and shows related papers in a separate panel.

## Shared Paper Components

Web rendering should use shared paper view-models and renderer helpers for:

- paper title / canonical id;
- source badge;
- tags;
- read state;
- linked and integrated topic counts;
- relation state when viewed from a topic;
- compact relation preview.

Library list, Library selected-paper detail, and Topic related-paper panels should not each invent their own single-paper presentation.

## Add Paper Flow

`/library` includes a prominent `Add paper` form.

Inputs:

- paper source: arXiv id, arXiv URL, or http(s) URL;
- optional comma-separated tags.

Behavior:

- POST `/library/add`;
- normalize through the same library command/store path as CLI;
- duplicate arXiv input updates the existing paper instead of creating a second row;
- redirect back to `/library`.

## Topic Adaptation

Topic pages show a compact `Related papers` panel when the library has links or integrations for that topic.

These papers are grouped visually by relation but remain separate from integrated note zones. Existing topic note counts continue to mean integrated notes only.

## Acceptance Criteria

- Web console has a top-level Library page.
- `Add paper` is visually prominent and persists through `PaperLibrary`.
- Duplicate arXiv add does not create duplicate paper rows.
- Library page, Library selected-paper panel, and topic page reuse shared paper rendering helpers.
- Topic related-paper links return to the unified Library workspace instead of a separate paper workspace.
- Topic page related papers are separate from `Active | Buffer | History`.
- Existing dashboard/topic note counts remain based on integrated notes only.
- Manual E2E verifies add, duplicate add, Library render, and Topic related-paper render.
