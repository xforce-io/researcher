# #212 L1 线框

静态 HTML 复用 `src/web/static/app.css`（ink & paper），新增失败条里的粘贴区样式在 `mockup.css`（实现阶段再并入 `app.css`）。

用无头 Chrome 渲成 PNG，桌面 1366×900。本目录 HTML 可直接用 `file://` 打开。

| 文件 | 状态 | 对应 L1 §4.3 |
|---|---|---|
| `01-normal-read.png` | 正常已深读 | B |
| `02-failed-too-short.png` | 抽取过短 | C |
| `03-fetch-error.png` | 抓取失败 | D |
| `04-rereading.png` | 重新深读进行中 | E |
| `05-paste-too-short.png` | 粘贴过短校验 | F |
| `06-paste-success.png` | 粘贴成功 | G |

文案以 [L1](../212-url-extract-readability.md) 为准。本 PR 未改产品代码，因此没有 :4500 活机上的新失败页截图。
