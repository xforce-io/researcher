---
name: papers
description: Discover, search, and deep-read papers via the researcher CLI (HuggingFace Daily Papers, arXiv, Library evidence cards)
version: "1.0.0"
tags: [papers, research, arxiv, huggingface, library]
---

# Papers

Use this skill whenever the user mentions a paper by name, asks to find/search a paper, wants today's AI paper digest, or wants a deep dive. Call the `researcher` CLI. Do **not** curl/wget PDFs, scrape HTML, write inline Python, or call paper-discovery scripts.

## When to Use

- Daily paper digest / 热榜 / 「推论文」
- User names a paper (e.g. "看看 SkillCraft")
- User has an arXiv ID
- User wants a deep read (「这篇详细说说」)

## Commands

JSON is the agent contract. Errors go to stderr; stdout is payload only.

```bash
researcher papers trending --format json --limit 10
researcher papers trending --format report --limit 10
researcher papers search "SkillCraft" --format json
researcher papers show 2401.12345 --format json
researcher papers read 2401.12345
```

| Command | Needs workspace? | Writes Library? |
|---|---|---|
| `trending` / `search` / `show` | no | no |
| `read` | default workspace | yes (evidence card) |

Default workspace comes from `--workspace`, else `RESEARCHER_WORKSPACE_ROOT`, else `workspace:` in `~/.researcher/config.yaml` (absolute path to a super-repo with `researcher.workspace.yml`).

### Flags

| Option | Values | Default | Where |
|---|---|---|---|
| `--limit` | integer | `10` trending / `5` search | trending, search |
| `--format` | `json`, `report` | `json` | trending, search, show |
| `--source` | `huggingface`, `arxiv`, `both` | `huggingface` | trending |
| `--category` | arXiv category | `cs.AI` | trending |
| `--workspace` | absolute path | config/env | read |

`--format report` is human digest text. Prefer `--format json` then write any product/落地 commentary yourself. The CLI does **not** have `--with-analysis` or `--with-summary`.

## JSON fields

Each item includes: `id` (`arxiv:YYMM.NNNNN`), `paper_id`, `title`, `authors`, `abstract`, `arxiv_url`, `pdf_url`, `source`, `published_date`, `heat_index`, `heat_level`. HuggingFace extras when present: `upvotes`, `hf_url`, `github_repo`, `github_stars`, `ai_summary`, `ai_keywords`.

## Daily digest

```bash
researcher papers trending --format json --limit 10
```

Then format for the user: title + heat, upvotes/stars, abstract or `ai_summary`, links. Optional agent-side interpretation (核心创新点 / 可复用技术点 / 落地价值) — **you** write that from the JSON; do not invent CLI flags for it.

## Deep read

```bash
researcher papers read <arxiv-id>
```

Stdout is the Library evidence card (Essence / Claims / … / Takeaway). If a completed card already exists, the CLI reprints it and does not re-run the model. Do not paraphrase the abstract and call it a deep dive.

## Errors

Non-zero exit: no hits, all sources failed, missing default workspace (read), or deep-read failure. Read stderr and tell the user. Do not retry by curling arXiv yourself.
