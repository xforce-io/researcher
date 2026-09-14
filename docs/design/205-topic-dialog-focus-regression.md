# 关联面板退出行为自动回归

状态：Approved。2026-09-14 用户回复「go」批准 [L1](https://github.com/xforce-io/researcher/issues/205#issuecomment-5657533154)。

## 1 背景

[#205](https://github.com/xforce-io/researcher/issues/205)；#203 的两轮焦点修复缺少自动浏览器回归。

## 2 名词解释

沿用 [名词表](../glossary.md)，无新增领域术语。

## 3 目标与非目标

自动发现各退出路径的焦点和 URL 退化。非目标：产品交互改变、全站 E2E 平台、真实 LLM、日常服务更新。

## 4 能力

### 4.1 UI/UX

页面保持不变。coding-agent 运行 npm test，看到类型/打开方式/退出入口命名的独立测试结果。缺 Chromium 或启动失败明确报错并给安装命令，不跳过。

## 5 思路与折衷

Vitest 管理测试，Playwright 仅作为开发依赖启动独立无头 Chromium。放弃 HTML 字符串断言和模拟 focus()，因为它们不能验证浏览器的默认行为与跨页焦点。接受首次安装 Chromium 的成本，不绑定开发者个人浏览器路径。

## 6 架构

夹具层用现有 Library API 在临时 workspace 创建三类文档与关联；HTTP 层使用 startServer 的随机回环端口；浏览器层访问真实页面及脚本；断言层检查 activeElement、dialog 状态与 URL。

主路径：启动隔离服务/浏览器→打开详情→进入普通/编辑面板→退出→焦点和 URL 检查→关闭 context。失败路径：启动或断言失败→测试失败→关闭浏览器/服务并清理临时目录。每例独立 context 避免 sessionStorage 互相掩盖。

## 7 模块

新增一份浏览器测试文件；修改开发依赖/lock、README 开发准备与 document-detail 功能地图。不修改产品文件。

## 8 API/CLI

N/A：产品 API/CLI 不变；沿用 npm test 与指定 Vitest 文件执行入口。

## 9 边界

三类文档 ×（普通关闭按钮、普通 Escape、编辑关闭按钮、编辑 Escape、编辑取消）共 15 条正向路径。普通态通过管理入口打开；编辑态通过面板内编辑链接进入。每例关闭后 dialog 不再打开，焦点指向管理入口，URL 回到该详情且无 edit。退出不能提交未保存理由或修改已有关系。

负向控制只在测试浏览器响应中注入退化：移除跨页恢复标记或取消链接绕过统一关闭。使用与正向相同的焦点检查，必须观测失败；不把超时/资源失败冒充成功检出。另覆盖普通退出恢复缺失。网络限制到隔离服务，不调用来源网站或模型。

## 10 迁移/兼容/回滚

无存数迁移；开发环境 npm ci 后 npx playwright install --no-shell chromium（Linux 必要时 --with-deps）。撤销测试/开发依赖即可回退；无日常服务变更。

## 11 测试计划

E2E：S1 的 15 条真实浏览器正向及受控退化检测，按 case 名报告；失败路径使用独立 context。Integration：现有 Web/Library 套件；Unit：现有套件。冻结 SHA 后构建、lint、完整 npm test，按功能地图执行自动回归并记录输出与候选 SHA。

## 12 开放问题

无。浏览器缺失是明确失败，不伪装 pass/skip。

## 13 关联

[#205](https://github.com/xforce-io/researcher/issues/205)、[#203](https://github.com/xforce-io/researcher/issues/203)、[PR #204](https://github.com/xforce-io/researcher/pull/204)。
