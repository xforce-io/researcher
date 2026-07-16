# 97 · Topic link Suggest + manual form (one panel)

Issue: https://github.com/xforce-io/researcher/issues/97

## Decision

Library paper detail **Topic link** panel:

1. **One panel** (`.topic-link-panel`): Suggest (optional) + editable fields + **primary Link topic** at the same level.
2. **Suggest** — top-k ≤3; click **only fills** fields (not a write). Status: “Selected X — press Link topic.”
3. **Link topic** — sole submit (`primary`, full width) → `POST /library/link`.
4. Empty suggestions → no Suggest chrome; form + primary Link remain.
5. Multi-link or integrated → hide Suggest; single link → weak “Also consider”.

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
