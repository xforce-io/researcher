# papers CLI（热榜 / 查篇 / 深读）

无工作区雷达 + 写入 default workspace Library 的深读。驾驶本仓库当前分支的 `node dist/cli.js`，不要用 PATH 上过期的 `researcher`。不要写开发者日常仓；default workspace 用独立验证根（`RESEARCHER_WORKSPACE_ROOT` 或 `--workspace`），S4 用空 HOME。

## 用户入口（必须都走）

1. **任意目录** `papers trending --format json --limit 10`（cwd 不是研究仓库）。
2. `papers search <关键词> --format json`：命中与未命中各一次。
3. `papers show <arxiv-id> --format json`：命中与未命中各一次。
4. `papers read <arxiv-id>`：default workspace 已配置时写入 Library 证据卡；再跑一次必须复用。
5. **Library / `serve` 论文页**：打开刚深读的那篇，页面能看到证据卡章节。
6. `papers read` 在无 default workspace 时失败（空 HOME、无 `RESEARCHER_WORKSPACE_ROOT`、无 `--workspace`）。
7. 仓库 `skills/papers/SKILL.md`：只指向上述 CLI，禁止 curl/wget/内联抓论文与 `fetch_papers.py`。

只跑单测或只调雷达不打开论文页，算未完成。

## 夹具

- 独立超级仓：`researcher.workspace.yml` + 一个 topic 支柱（与 `tests/web/library-video.test.ts` 同形）。
- 雷达与查篇需要外网（HF Daily Papers / arXiv）。
- 深读走本机已配 runtime（不要为验证改 `~/.researcher/config.yaml`）。

## #170 S1

前置：`node dist/cli.js` 可执行；当前目录不是研究仓库。

运行 `node dist/cli.js papers trending --format json --limit 10`，从 stdout 读 JSON。

判定：stdout 是 JSON 数组；篇数 ≤ 10；每篇含稳定 id、title、arxiv/pdf 链接、热度；错误只在 stderr。默认走 HF Daily Papers（条目 `source` 为 huggingface，或 HF 失败时 stderr 可判定并回退/非零退出）。

## #170 S2

前置：无工作区。

`papers search` 命中关键词 → stdout JSON 含 title、abstract、arxiv_url。再搜一个不可能命中的串 → 非零退出，stderr 可判定。

`papers show` 一个真实 arXiv id → 同样的元数据 JSON。`show` 一个不存在的 id → 非零退出。两次都不写 Library、不跑深读。

## #170 S3

前置：验证 workspace 被解析为 default（`RESEARCHER_WORKSPACE_ROOT` 或 `--workspace`，指向独立根，不指向日常仓）。

`papers read <arxiv-id>` 等到结束 → 该 Library 出现完成证据卡 → `serve` 打开该论文页。stdout 给出卡片正文或路径。再跑一次同一 id：stderr 含 reuse，不新跑模型。不改 topic `notes/`。

判定：证据卡含 Essence / Claims / Assumptions / Method / Eval / Weaknesses / Relations / Takeaway；第二次不新增 read 产物。

## #170 S4

前置：HOME 下无有效 `~/.researcher/config.yaml` workspace，且无 `RESEARCHER_WORKSPACE_ROOT`、无 `--workspace`。

运行 `papers read <arxiv-id>`。非零退出；stderr 写明缺 default workspace 以及如何配置；任意 cwd 都不落盘。

## #170 S5

前置：本仓库 `skills/papers/SKILL.md`。

按该文档执行热榜、search/show、以及（有 workspace 时）`papers read`。文档只允许这些 CLI，禁止 curl/wget/内联脚本抓论文，不出现 `fetch_papers.py`。深度走 Library 证据卡而不是摘要扩写。

## 不做

不把热榜灌进 `run --discover`；不改 `researcher read`（topic pending）；不写 kweaver/产品落地评估；不改 demo_agent HEARTBEAT。
