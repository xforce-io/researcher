# Library 视频改标题

Web 控制台。无 CLI 改名入口。

## 用户入口（必须走）

1. **视频详情 Title 输入 + Save title**：改显示标题并保存。超长错误显示在标题旁，不离开页面。

## #194 S1

前置：Library 已有 1 条 video。

打开详情 → 改标题 → Save title → 回 Library → 再打开。列表与详情均为新标题；媒体与台词不变；documentId 不变；仍 1 条。

## #194 S2

必须能键入或粘贴满 201 个 Unicode 码点（禁止 `maxlength` 或截断使 Save 不可达）→ Save title → 标题旁可见错误、磁盘原标题保留 → 改成合法标题再 Save 成功。控件让该操作不可达则本 Story fail，不要改走纯 API 顶替。

## 不做

改文件名/指纹、台词编辑、note 整页编辑器。
