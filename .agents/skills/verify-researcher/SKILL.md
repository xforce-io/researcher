---
name: verify-researcher
description: Use when keel-verify must drive the researcher web console on a real user path (Library, video Analyze, notes, Home).
---

# verify-researcher

驾驶 **researcher 本地 Web 控制台**。Issue 验收对 `features/`；只 Drive 对上的功能文件。

## Launch

在**本仓库当前分支**构建，不要用 PATH 上过期的 `researcher`。

```bash
npm run build
```

独立验证 workspace（含 `researcher.workspace.yml`），不要用开发者日常仓除非 Issue 点名。秒级 mp4 夹具；禁止用长样片。

```bash
ROOT=/tmp/researcher-verify-ws
PORT=45193
# 若 ROOT 不存在：git init 超级仓 + 一个 topic 支柱（与 tests/web/library-video.test.ts 同形）
node dist/cli.js serve "$ROOT" -p "$PORT"
```

控制台：`http://127.0.0.1:$PORT/`。日志写入 Evidence 目录的 `serve.log`。

serve 放后台；先确认 `http://127.0.0.1:$PORT/library` 可连再 Doctor。Cleanup 只停本次进程，不要停用户日常 4500。

## Doctor

全部成立才 Drive：

1. `curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/library` 为 `200`
2. HTML 含 `Library` 与 `Add video`
3. 本机 `ffmpeg` 在 PATH；`mlx_whisper` 或 `whisper` 在 PATH（只 Drive 视频分析时）

失败则 `BLOCKED`，不要点 UI。

## Drive

只打开 `features/` 里对上本 Issue `S1…Sn` 的文件（外加本次会碰到的、先前已 pass 的功能）。文件列出的**每一条用户入口都要走**；只走 API 或只走按钮其中一条算未完成。

控件（`maxlength`、`disabled`）使某条 `S*` 的规定操作不可达 → 该 Story `fail`，不要改操作迁就 UI。

## Evidence

每次 Drive 写入仓库 `.grok/verify-runs/<issue-no>/`（该目录不进 git）：

| 文件 | 内容 |
|---|---|
| `doctor.txt` | Doctor 命令与结果 |
| `sN-*.png` | 关键画面截图 |
| `sN.json` | 详情 `Accept: application/json` 或分析 GET 原文 |
| `notes.md` | 入口、documentId、观察 |

截图用浏览器；JSON 用页面同源 GET 或 `curl`。

## Cleanup

停掉**本次 Launch 的 serve**（不要停用户 4500 上的日常进程）。可删验证 workspace。**不得删除** `.grok/verify-runs/`。
