# 97 · Topic link Suggest + manual form (one panel)

Issue: https://github.com/xforce-io/researcher/issues/97

## Decision

Library paper detail **Topic link** panel:

1. **Suggest** (heuristic) — top-k ≤3 topics with short why; click **only fills** the form.
2. **Manual form** — topic / relation / rationale; sole **Link topic** submit → `POST /library/link`.
3. Empty suggestions → no Suggest chrome (manual only).
4. Multi-link or integrated → hide Suggest; single link → weak “Also consider”.

Score is never written to `links.jsonl`.

## Signals (MVP)

- Paper: title, tags, note bodies (pinned first), latest read Essence/Takeaway/Brief
- Topic: path, `project.yaml` oneline, thesis.md, optional charter.md

Pure function: `suggestTopicLinks` in `src/web/topic-link-suggest.ts`.
View model: `loadLibraryPaper` → `topicSuggestions`.

## Non-goals

- One-click auto-link on suggest rows
- LLM ranking
- Home bulk recommend
