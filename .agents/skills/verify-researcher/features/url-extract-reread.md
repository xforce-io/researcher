# URL 抽取与粘贴全文重新深读（#212）

隔离 workspace。不要打日常 :4500，不要用个人浏览器状态。every.to 正文用仓库夹具或本地 serve 的静态 HTML，默认 `npm test` 不打 live every.to。桌面 1366×768。

## 用户入口（必须走）

1. **S1 抽取**：Library 打开 every.to 这篇（夹具强制重抓或本地静态页）。深读成功后产物正文 ≥ 1000 字，含 `blank slate` / `Eight Levels` 一类原文，不是文末推荐卡。身份表「抽取」为 Readability 或「已回退备用抽取」，与读记 `extractionMethod` 一致。
2. **S2 过短失败**：打开人造过短页文档，点深读。元数据是「深读失败」不是「已深读」；无新产物；条上有中文原因和字/词。磁盘无新 cache txt。
3. **S3 粘贴**：同一失败页出现「原文全文」框与「用粘贴全文重新深读」。贴过短 → 按钮 disabled 或 422 内联红字，不新建 reading。贴达标 → 成功后身份表有「正文来源：用户粘贴」，无失败条。强制重新抓取走 `forceRefetch`，不命中坏缓存。
4. **S4 缓存自愈**：先写入过短毒缓存再深读：HTTP 被调用（或夹具路径重抽），成功正文进产物；过短结果不进 `RESEARCHER_HOME/cache/url`。

## Evidence

`.grok/verify-runs/212/`：`doctor.txt`、失败六态与粘贴成功截图、`sN.json`（GET reads）、`notes.md`（documentId、extractionMethod、字数）。

## 自动回归

`npm test -- tests/sources/url-extract.test.ts tests/sources/url-fetch.test.ts tests/web/views.test.ts tests/web/server.test.ts tests/web/library-read.test.ts`

独立 clone 冒烟：`npm ci && npm run build && node scripts/smoke-212-url-extract.mjs --cache-dir "$TMP"`。Node 目标 v23.11.0。
