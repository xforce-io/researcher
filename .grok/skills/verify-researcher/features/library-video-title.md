# Library 视频改标题

Web 控制台。无 CLI 改名入口。

## 用户入口（必须走）

1. **视频详情 Title 输入 + Save title**：改显示标题并保存。超长错误显示在标题旁，不离开页面。

## #194 S1

前置：Library 已有 1 条 video。

打开详情 → 改标题 → Save title → 回 Library → 再打开。列表与详情均为新标题；媒体与台词不变；documentId 不变；仍 1 条。

## #194 S2

输入超过 200 个 Unicode 码点 → Save → 可见错误、原标题保留 → 改成合法标题再 Save 成功。

## 不做

改文件名/指纹、台词编辑、note 整页编辑器。
