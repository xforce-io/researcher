# 名词表

| 规范名 | 一句话定义 | 禁止别称 |
|---|---|---|
| topic | 单个研究主题仓：有 `.researcher/` 与一份工作论题，是深耕与 PR 的原子单位。 | 支柱仓、子项目 |
| workspace | 含 `researcher.workspace.yml` 的超级仓：多 topic 的控制面，一份 Library 挂在这里。 | 超级仓根、多仓、instance |
| default workspace | `$RESEARCHER_HOME/config.yaml` 里登记的当前超级仓路径，是 `papers read` 的 Library 落盘目标。 | 当前工作区、默认主题、researcher instance |
| Library | workspace 级论文对象库：元数据、深读证据卡与 topic 链接，不属于任何一个 topic。 | 论文库、inbox、notes |
| Essence | Library 深读首屏：场景 / 对照 / 步骤 / 证据（含别误读），不是摘要腔 Brief。 | Brief、问题/做法四段 |
| thesis | 单个 topic 的工作论题，驱动该支柱的 triage / 综合，不驱动热榜。 | 研究 spec、主张文档 |
| papers CLI | `researcher papers` 子命令组：热榜、按名搜索、按 ID 取元数据、写入 default workspace Library 的深读。 | paper-discovery、热榜脚本 |
| 热榜 | `papers trending` 按社区热度列出的当日论文列表；不进入 thesis discover。 | trending 种子、discover 热门 |
| 社区热度 | Hugging Face upvote > 0 或 GitHub stars > 0；热榜只保留满足该条件的条目。 | 引用量、新鲜度、heat_index 本身 |
| Workspace sync | 超级仓根的显式 git 对齐动作，不改 `delivery.mode`。 | 自动同步 |
| Topic delivery | `.researcher/project.yaml` 的 `delivery.mode`，只决定 package 是否 push 并开 PR。 | — |
| Library sync | `workspace sync --library`：把允许的 Library 文件提交进超级仓，不开 PR、不 push。 | library publish、library delivery |
| Pointer | 超级仓中记录的 submodule commit SHA（gitlink）。 | — |
