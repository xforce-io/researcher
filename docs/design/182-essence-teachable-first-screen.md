# #182 深读首屏改成场景/对照/步骤/证据

- Issue：[#182](https://github.com/xforce-io/researcher/issues/182)
- L1：会话批准（2026-09-06）：学 compile-by-training 讲解顺序，不做图解站。
- 分支：`feat/182-essence-teachable-first-screen`
- 状态：Approved
- 日期：2026-09-06

本文件是详细设计唯一事实源。Issue 仅保留不超过 10 行的设计摘要与链接。

## 1. 背景

[#182](https://github.com/xforce-io/researcher/issues/182)。[#98](./98-essence-replaces-brief.md) 把 Brief 换成 Essence（问题/做法/证据/边界），首屏仍常被写成论文压缩稿。

## 2. 名词解释

- **Essence**、**Frame**、Library 深读：见[名词表](../glossary.md) 与 #98。
- **讲解腔**：场景、对照、步骤、一条证据加别误读；不是摘要腔。

## 3. 目标与非目标

### 3.1 目标

- S1：新读卡 Frame 一句场景→改动→好处（约 ≤50 字）；Essence 四个 `###`：场景 / 对照 / 步骤 / 证据（含别误读）。
- S2：H2 顺序不变；无新 H2；无 JSON 变更；历史 Brief 仍显示为 Essence 槽。

### 3.2 非目标

不生成每篇 HTML 图解。不自动重跑历史读卡。不改 Claims…Takeaway。不写主题产品建议。

## 4. 能力

### 4.1 UI/UX

论文页仍是同一详情。Essence 下四个 `h3` 加 `essence-lead` 并做成浅卡片。无卡片时 Markdown 仍可读。空/错：读失败路径不变。

## 5. 思路与折衷

只改质量条与首屏呈现，不改 H2 契约。写作纪律对 Frame+Essence 开讲解例外，Claims 起仍密集。放弃独立图解站。

## 6. 架构

```mermaid
flowchart LR
  Prompt[stage-library-read 质量条] --> Artifact[Markdown 卡]
  Artifact --> Display[displayLibraryReadMarkdown]
  Display --> HTML[markedHtml]
  HTML --> Mark[markEssenceLeadHeadings]
  Mark --> Page[论文页]
```

主路径：新 deep-read 写出四个 `###` → 页面卡片。  
失败路径：缺 H2 仍按既有 runner 拒绝；旧 问题/做法 卡原样显示，不强制改写。

## 7. 模块

- `prompts/stage-library-read.md`、`stage-library-read-doc.md`
- `methodology/06-writing.md`
- `src/web/library-read-sections.ts`：`markEssenceLeadHeadings`
- `src/web/views.ts`、`app.css`
- 契约测试

## 8. API/CLI

无新 CLI、无新 JSON 字段。`papers read` stdout 仍是 Markdown 卡。

## 9. 边界

旧卡不迁移。Frame 50 字只写在 prompt 里，不做运行时拒稿。

## 10. 迁移/兼容/回滚

无存数迁移。回滚即恢复旧质量条与 CSS。Brief→Essence 回退保留。

## 11. 测试计划

| 层级 | 判定 |
|---|---|
| Unit/S1 | 真实 prompt 文件含 场景/对照/步骤/证据与别误读，不含 **问题**/**做法**/**边界** 作为首屏契约 |
| Unit/S2 | `PAPER_READ_SECTIONS` 仍 Essence 先于 Claims；Brief 显示回退仍过 |
| Unit | `markEssenceLeadHeadings` 只给 Essence 段 h3 加 class；`renderLibraryPaper` HTML 含四个标题与 class |
| Integration | stub runner 完整卡用新 Essence 形，`runLibraryRead` 仍接受 |

## 12. 开放问题

无。

## 13. 关联

[#182](https://github.com/xforce-io/researcher/issues/182)；#98。
