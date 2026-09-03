# 名词表

| 规范名 | 一句话定义 | 禁止别称 |
|---|---|---|
| Library | 工作区级论文对象及其机器深读、人工 Notes 的账本，不属于任一 topic。 | 论文库、纸本库 |
| Topic | 论题驱动的独立研究仓；产出 thesis、landscape、report 与综合笔记。 | — |
| Workspace sync | 超级仓根的显式 git 对齐动作，不改 `delivery.mode`。 | 自动同步 |
| Topic delivery | `.researcher/project.yaml` 的 `delivery.mode`，只决定 package 是否 push 并开 PR。 | — |
| Library sync | `workspace sync --library`：把允许的 Library 文件提交进超级仓，不开 PR、不 push。 | library publish、library delivery |
| Pointer | 超级仓中记录的 submodule commit SHA（gitlink）。 | — |
