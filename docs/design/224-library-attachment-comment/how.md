# how: Library 文档批注与媒体附属（#224）

- 日期：2026-10-30 Asia/Shanghai
- 分支：`feat/224-library-attachment-comment` @ `b73498e`
- 范围：将改「文档批注」子系统；对照视频媒体附属存数模式

## Overview

Library 文档批注（glossary：文档批注）今天是**纯文本**人类记录，落在 workspace `annotations.jsonl`，经 Web `…/annotations` CRUD。视频文档另有**媒体文件**附属：字节落在 `documents/<id>/assets/`，元数据挂在文档 frontmatter 的 `media`。#224 要的「附件类型 comment」尚不存在：批注模型没有附件字段，上传路径只服务 video 入库。

## 怎么跑

1. Web Console（`researcher serve`）打开 Library 文档详情 → 文本批注列表 / POST 新建（仅 `body` 字符串）。
2. 视频：`POST /library/documents/videos` 多部分上传 → `PaperLibrary.createVideo` 写入 assets + document.md。
3. CLI：`library add|import|show|…`，**无** comment/attach 子命令。

## 东西在哪

| 机制 | 出处 |
|---|---|
| `PaperNote` / kind 枚举 | `src/library/model.ts`（`body: string`，无附件） |
| `upsertNote` / `listNotes` / `annotations.jsonl` | `src/library/store.ts` |
| Web annotations GET/POST/PATCH/DELETE | `src/web/server.ts`（`rest === 'annotations'`；POST 只收 JSON `body`/`kind`/`pinned`） |
| 视频入库与 assets 路径 | `src/library/store.ts` `createVideo` / `videoMediaPath`；`src/web/server.ts` `POST /library/documents/videos`；`src/web/multipart.ts` |
| 名词「文档批注」 | `docs/glossary.md` |
| 详情 verify 地图 | `.agents/skills/verify-researcher/features/document-detail.md` |

## Gotchas

- 自主笔记（`docType=note`）与文档批注是不同概念；批注依附已有文档，不具文档身份。
- 视频 media **不去重指纹**；批注附件若复用 assets，需明确是否允许多条批注引用同一文件。
- Library sync（#173/#191）对媒体二进制有排除口径；附件 comment 的二进制是否进 sync 须在 L2 对齐产品规则。
- 活机 `:4500` 仍可能停在旧 HEAD；CLI tip 可写 workspace 文件，Web 验附件需部署后 tip。
