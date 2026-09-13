# Library 视频分析

Web 控制台。无 CLI analyze 入口。

## 用户入口（必须都走）

1. **Library → ＋ → Add video**：选 `.mp4` / `.webm`，提交中按钮为 Adding…，成功进入该视频详情。
2. **视频详情 Analyze**：媒体在且运行时可用时可点；进行中文案 `Analyzing…` 且按钮禁用。

## 夹具

- 秒级、含清晰语音的 mp4（例如 macOS `say` 再封装）。无语音样片只用于 #191 成功空，不用于 #193 S1。
- #193 S2：在已有成功台词后，向该文档写入一条**更新**的 `queued`/`running` 记录且 serve **无活任务**（模拟进程已死）。不要用仍在跑的分析。

## #193 S1

前置：详情已有至少 1 句成功台词。

1. 点 Analyze。
2. 看到 `Analyzing…`（或瞬时完成后已离开进行中）。
3. 等到离开 Analyzing：台词可搜可点；Analyze 可再点；无 `data-analyzing`。
4. 转写成功但没有中文台词时，不得停在 Analyzing。

判定：同一 `documentId`，Library 仍 1 条该视频。JSON `analysis.status` 为 `done` 或随后可再 POST 202。

## #193 S2

前置：已有成功台词；磁盘最新分析为 `queued`/`running` 且无活任务。

1. 打开或刷新详情。
2. 不得保持 Analyzing；可见上次台词；错误为 `Analysis interrupted`；Analyze 可点。
3. 再点 Analyze，新一轮能启动（202 新 id）。

判定：`documentId` 不变；新分析完成前旧台词仍在。

## #200 S1

前置：Library 已有 1 条已分析视频；详情 Topic 面板（含 Suggest）内容高度高于剩余视口。

打开该视频详情。不得只见 Title / Analyze / Topic link。播放器与至少一条台词在首屏可见；`.video-head` 可滚。

判定：`.video-workbench`、`video`、`#cues` 渲染高度均 > 8px 且与视口相交；documentId 不变。

## 不做

进度条、取消、分析历史、把 Analyze 当只读、改标题。
