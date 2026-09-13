# 名词表

| 规范名 | 一句话定义 | 禁止别称 |
|---|---|---|
| topic | 单个研究主题仓：有 `.researcher/` 与一份工作论题，是深耕与 PR 的原子单位。 | 支柱仓、子项目 |
| workspace | 含 `researcher.workspace.yml` 的超级仓：多 topic 的控制面，一份 Library 挂在这里。 | 超级仓根、多仓、instance |
| default workspace | `$RESEARCHER_HOME/config.yaml` 里登记的当前超级仓路径，是 `papers read` 的 Library 落盘目标。 | 当前工作区、默认主题、researcher instance |
| Library | workspace 级文档集合，统一管理各类文档及其与 topic 的关联，不属于任何一个 topic。 | 论文库、inbox、notes |
| Essence | Library 深读首屏：场景 / 对照 / 步骤 / 证据（含别误读），不是摘要腔 Brief。 | Brief、问题/做法四段 |
| thesis | 单个 topic 的工作论题，驱动该支柱的 triage / 综合，不驱动热榜。 | 研究 spec、主张文档 |
| papers CLI | `researcher papers` 子命令组：热榜、按名搜索、按 ID 取元数据、写入 default workspace Library 的深读。 | paper-discovery、热榜脚本 |
| 热榜 | `papers trending` 按社区热度列出的当日论文列表；不进入 thesis discover。 | trending 种子、discover 热门 |
| 社区热度 | Hugging Face upvote > 0 或 GitHub stars > 0；热榜只保留满足该条件的条目。 | 引用量、新鲜度、heat_index 本身 |
| Workspace sync | 超级仓根的显式 git 对齐动作，不改 `delivery.mode`。 | 自动同步 |
| Topic delivery | `.researcher/project.yaml` 的 `delivery.mode`，只决定 package 是否 push 并开 PR。 | — |
| Library sync | `workspace sync --library`：把允许的 Library 文件提交进超级仓，不开 PR、不 push。 | library publish、library delivery |
| Pointer | 超级仓中记录的 submodule commit SHA（gitlink）。 | — |
| 文档 | Library 中具有独立身份、可保存和浏览的内容单元，paper、blog、note、video 等为平级类型。 | — |
| paper | 文档中内容形式为学术论文的一类。 | — |
| 自主笔记 | 类型为 note、由用户维护的独立文档，不要求外部来源或 topic，不能被机器重跑覆盖。 | 独立笔记 |
| 视频 | Library 文档中内容形式为时基音视频的一类，主对象是已入库媒体，不要求外部来源或 topic。 | 片子、片源 |
| 台词 | 依附某条视频文档、带起止时间的一句转写文本；是视频分析产物，不是独立文档，也不是用户维护正文。 | 字幕条、caption、segment |
| 中文台词 | 某句台词的简体中文对应句，存在该句的 `zh` 字段；翻译失败时可以没有。 | 中文字幕、双语 |
| 视频分析 | 对本机已入库视频抽音并转写、生成或替换当前台词产物的动作；不是深读。 | ASR、Whisper、解析 |
| 活任务 | 本 serve 进程内尚未结束的那一次视频分析执行；磁盘 `queued`/`running` 或 tmp 残留都不算。 | 后台 job、PID |
| 媒体指纹 | 已入库视频文件字节的 SHA-256，用于判定恢复文件是否为同一份媒体。 | 校验和、文件 hash |
| topic 关联 | 某份文档与某个 topic 之间的显式关系，独立于文档内容形式，也不表示是否已集成。 | 挂载、绑定、link 记录 |
| 集成来源 | 某份已关联文档进入 topic 集成时被引用的内容：外部材料用深读产物，自主笔记用正文，视频用台词。 | 集成素材、integrate 输入 |
| 深读记录 | 针对某份文档的一次深读执行记录，承载执行状态和对应产物信息。 | — |
| 深读产物 | 基于文档由深读执行生成的附属内容，不作为 Library 中的独立文档。 | — |
| 文档批注 | 依附具体文档的人类记录，独立于深读产物且不具有文档身份，kind=note 仅指普通批注而非自主笔记，本期用于已有外部材料。 | 论文批注 |
