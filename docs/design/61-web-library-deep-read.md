# Issue 61: Web Library deep-read action

- Issue: https://github.com/xforce-io/researcher/issues/61
- PR: https://github.com/xforce-io/researcher/pull/63

## Context

The workspace Library is now the paper intake and review surface. A user can add a paper, select it in `/library?paper=<paperId>`, and see reads, tags, relations, integrations, and a compact relation map.

Before this change, the Web Library had no way to start a deep-read from a selected paper. Users had to leave the UI and run `researcher read <input>` inside a topic directory, which incorrectly made reading feel owned by a topic.

## Decision

Add `Deep read` as a selected-paper action in the Library.

The Library owns the paper, read status, and read artifact. A deep-read can happen without any topic.

Topic context is optional. When provided, it is used as reading context only; the artifact still lands in the workspace Library. Topic integration is a later action that consumes a Library paper/read and records how it relates to a topic.

## User Flow

1. User adds or opens a paper in the Library.
2. `/library?paper=<paperId>` shows the selected-paper panel.
3. The panel includes a `Deep read` action and an optional context selector.
4. If the paper is linked to exactly one topic, that topic is selected by default as optional context.
5. User submits the form.
6. Web records a Library read row with status `reading`.
7. Web starts a background task that writes a standalone Library read artifact.
8. On success, the Library read row becomes `read` and stores the Library artifact path.
9. On failure, the Library read row becomes `failed`.

No synthesis, package, topic integration, or PR creation is triggered by this action.

## Backend Shape

- Extend `TaskRegistry` with `startJob()` while preserving the existing topic `run` API.
- Add `src/web/library-read.ts` as the Library-level read runner.
- Add `POST /library/read`.
- Reuse the existing source acquisition logic from the topic read pipeline.
- Store read artifacts under `.researcher-workspace/library/papers/<paperId>/reads/<readId>.md`.
- If optional topic context is provided, reuse the existing workspace topic path guard through `resolveTopicDir`.
- Use task keys in the form `library-read:<paperId>` to reject duplicate concurrent reads.
- Use stable read IDs in the form `read_<paperId>`.

## UI Shape

The selected-paper panel includes:

- read status chip;
- optional context selector;
- `Deep read` primary action;
- existing Reads, Relations, Integrations, and Mini map panels.

The Add paper modal's Topic context is also persisted as a `candidate` Library topic link, so a paper added with a topic immediately has a sensible default topic for deep-read.

## Acceptance Criteria

- Library selected-paper panel has a `Deep read` action.
- The action works without topic context.
- Optional topic context defaults to a single linked topic when available.
- Triggering deep read from Web writes a standalone Library read artifact.
- The workspace Library records `reading`, `read`, and `failed` states in `reads.jsonl`.
- Duplicate reads for the same paper are rejected while one is running.
- No synthesis, package, integration, or PR is triggered.
- Tests cover discovery, view, server, and task behavior.
