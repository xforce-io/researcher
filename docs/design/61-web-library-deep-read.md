# Issue 61: Web Library deep-read action

- Issue: https://github.com/xforce-io/researcher/issues/61
- PR: https://github.com/xforce-io/researcher/pull/62

## Context

The workspace Library is now the paper intake and review surface. A user can add a paper, select it in `/library?paper=<paperId>`, and see reads, tags, relations, integrations, and a compact relation map.

Before this change, the Web Library had no way to start the existing deep-read flow from a selected paper. Users had to leave the UI and run `researcher read <input>` inside a topic directory.

## Decision

Add `Deep read` as a selected-paper action in the Library.

The Library owns the paper and read status. The actual reading artifact remains topic-local because the current `researcher read` pipeline writes pending notes under a topic's `notes/pending/` directory and uses that topic's thesis, project YAML, prompts, and methodology.

## User Flow

1. User adds or opens a paper in the Library.
2. `/library?paper=<paperId>` shows the selected-paper panel.
3. The panel includes a `Deep read` action and a topic selector.
4. If the paper is linked to exactly one topic, that topic is selected by default.
5. User submits the form.
6. Web records a Library read row with status `reading`.
7. Web starts a background task that calls the existing `runRead({ cwd: topicDir, input })`.
8. On success, the Library read row becomes `read` and stores the discovered pending-note artifact path.
9. On failure, the Library read row becomes `failed`.

No synthesis, package, topic integration, or PR creation is triggered by this action.

## Backend Shape

- Extend `TaskRegistry` with `startJob()` while preserving the existing topic `run` API.
- Add `src/web/library-read.ts` as the thin adapter from Library paper records to `runRead`.
- Add `POST /library/read`.
- Reuse the existing workspace topic path guard through `resolveTopicDir`.
- Use task keys in the form `library-read:<paperId>:<topic>` to reject duplicate concurrent reads.
- Use stable read IDs in the form `read_<paperId>_<topic>`.

## UI Shape

The selected-paper panel includes:

- read status chip;
- topic selector;
- `Deep read` primary action;
- existing Reads, Relations, Integrations, and Mini map panels.

The Add paper modal's Topic context is also persisted as a `candidate` Library topic link, so a paper added with a topic immediately has a sensible default topic for deep-read.

## Acceptance Criteria

- Library selected-paper panel has a `Deep read` action.
- The action requires a topic context and defaults to a single linked topic when available.
- Triggering deep read from Web reuses CLI `researcher read` behavior.
- The workspace Library records `reading`, `read`, and `failed` states in `reads.jsonl`.
- Duplicate reads for the same paper/topic are rejected while one is running.
- No synthesis, package, integration, or PR is triggered.
- Tests cover discovery, view, server, and task behavior.
