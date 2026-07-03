# Issue 69: Runner-owned Library read artifacts

Issue: https://github.com/xforce-io/researcher/issues/69
Pull request: https://github.com/xforce-io/researcher/pull/70

## Problem

Library deep read previously asked the `researcher` Milkie agent to generate the
read artifact and write the artifact file via tool call. On long papers this
failed in a misleading way: the model consumed its output budget in
`reasoning_content`, returned no content and no tool call, and Milkie marked the
run completed with empty output. The web task then failed because the expected
artifact file was never written.

## Decision

The Library read runner owns the file and state boundary.

- The model returns only the Markdown artifact body.
- `runLibraryRead()` writes the artifact file and owns all frontmatter.
- `runLibraryRead()` records success only after artifact content exists and the
  file is written.
- Truncated model output is a hard failure, not a partial success.

## Implementation

`stage-library-read.md` now instructs the model to return only the Markdown body:
no file writes, no tool calls, no frontmatter, and no `FILES_MODIFIED` block.

`runLibraryRead()` composes the frontmatter from fetched metadata and paper
state, normalizes the model body, and writes:

`.researcher-workspace/library/papers/<paperId>/reads/<readId>.md`

The default Library read adapter is `OpenAITextAdapter`, an OpenAI-compatible
text adapter used for this content-generation path. It passes:

- `max_tokens: 8192`
- `thinking: { type: "disabled" }`

The explicit thinking disable is required for GLM reasoning models; otherwise
the model can spend the whole output budget in hidden reasoning and return no
artifact content.

`MilkieAdapter` still supports other agent-backed stages. It now recovers
`finishReason` from `.milkie/runs/<runId>.jsonl` so callers can detect
`finishReason === "length"` when Milkie is used.

## Failure Semantics

Library read fails when:

- the adapter exits non-zero;
- the provider finish reason is `length`;
- the adapter returns empty artifact content.

The previous fallback artifact behavior is removed from the success path.

## Verification

- Unit tests cover runner-owned artifact writing, empty-content failure,
  truncation failure, OpenAI-compatible `max_tokens` and thinking-disabled
  request construction, and Milkie finish-reason recovery.
- Full test suite passes.
- End-to-end web retry for `paper_arxiv_2607_01224` succeeds: HTTP task ends
  with `status: done`, the read artifact exists, and `reads.jsonl` records
  `status: "read"`.
