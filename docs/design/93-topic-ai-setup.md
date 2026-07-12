# 93 · New topic 后 AI 辅助 Complete setup

Issue: https://github.com/xforce-io/researcher/issues/93  
Depends: #91 / #92 (local New topic + Needs setup)  
Branch: `feat/93-topic-ai-setup`

## Goal

Web 两步式第二步：**Complete setup** 用 AI 生成可审的 `project.yaml` + `thesis.md`，确认后写入并清除 Needs setup。

| Step | AI | Result |
|------|----|--------|
| Create (#91) | no | scaffold + manifest |
| Complete setup (this) | yes | thesis + project soul applied |

## Non-goals

- Full 6-question TUI in the browser
- AI inside the Create modal
- Recalibrate already-setup topics
- SSE task registry (MVP is synchronous generate)

## UX

On `/t/:slug` when `needsSetup`:

1. Banner CTA **Complete setup**
2. Modal form: oneline (required, prefilled), stake (optional), seeds (optional), language (optional)
3. **Generate draft** → loading → review thesis + project.yaml
4. **Apply** | **Regenerate** | **Cancel**

## HTTP

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/t/:slug/setup/generate` | form fields | JSON `{ thesisMd, projectYaml }` |
| POST | `/t/:slug/setup/apply` | `projectYaml`, `thesisMd`, `oneline` | 303 `/t/:slug` |

Guards: topic exists; `isOnboardable` (still template-ish); else 409.

## Kernel

`src/web/topic-setup.ts`:

- Map form → `SerializedAnswer[]` (Q1 oneline; Q8 stake; Q6 seeds; rest skipped)
- `generateTopicSetup` → `rewriteAnswers` with injectable `AgentRuntime`
- `applyTopicSetup` → `writeOnboardArtifacts` + run log already from generate path

## E2E

1. Create topic via Web → Needs setup  
2. Complete setup → Generate (mock or milkie) → Apply  
3. Needs setup gone; thesis not template  
4. Generate again → 409  
