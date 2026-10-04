#!/usr/bin/env python3
"""Generate static L1 wireframes that reuse researcher app.css."""

from pathlib import Path

HERE = Path(__file__).resolve().parent
CSS_APP = "../../../../src/web/static/app.css"
TITLE = "How to Get Better at AI by Asking AI"
DOC_ID = "paper_url_68770fd28371a54c"

INSPECTOR_FAILED = f"""
      <aside class="paper-inspector">
        <section class="inspector-block"><h2>集成记录</h2><ul class="meta-list"><li class="muted">尚无集成记录</li></ul></section>
        <section class="inspector-block"><h2>深读记录</h2><ul class="meta-list">
          <li class="read-item"><span class="status-badge failed">深读失败</span></li>
        </ul></section>
        <section class="inspector-block inspector-danger"><h2>删除文档</h2>
          <p class="muted">删除此未关联的文档及其深读记录。</p>
          <button class="danger" type="button">从 Library 删除</button>
        </section>
      </aside>"""

INSPECTOR_READ = f"""
      <aside class="paper-inspector">
        <section class="inspector-block"><h2>深读产物</h2>
          <p class="mono read-path">read_{DOC_ID}.md</p></section>
        <section class="inspector-block"><h2>集成记录</h2><ul class="meta-list"><li class="muted">尚无集成记录</li></ul></section>
        <section class="inspector-block"><h2>深读记录</h2><ul class="meta-list">
          <li class="read-item"><span class="status-badge read">已深读</span>
            <span class="read-path mono">read_{DOC_ID}.md</span></li>
        </ul></section>
        <section class="inspector-block inspector-danger"><h2>删除文档</h2>
          <p class="muted">删除此未关联的文档及其深读记录。</p>
          <button class="danger" type="button">从 Library 删除</button>
        </section>
      </aside>"""

INSPECTOR_READING = f"""
      <aside class="paper-inspector">
        <section class="inspector-block"><h2>集成记录</h2><ul class="meta-list"><li class="muted">尚无集成记录</li></ul></section>
        <section class="inspector-block"><h2>深读记录</h2><ul class="meta-list">
          <li class="read-item"><span class="status-badge reading">深读中</span></li>
        </ul></section>
      </aside>"""

PASTE_OK = """
        <form class="paste-reread">
          <label>原文全文
            <textarea name="pastedText" rows="6" placeholder="把原文全文粘贴到这里"></textarea>
          </label>
          <div class="read-actions">
            <button class="primary" type="button" disabled>用粘贴全文重新深读</button>
            {secondary}
          </div>
        </form>"""

PASTE_SHORT = """
        <form class="paste-reread">
          <label>原文全文
            <textarea name="pastedText" rows="6">I asked Codex to grade my AI habits.</textarea>
          </label>
          <p class="field-error">粘贴内容过短（320 字 / 48 词）。请贴全文后再试，门槛是 1000 字或 150 词。</p>
          <div class="read-actions">
            <button class="primary" type="button" disabled>用粘贴全文重新深读</button>
            <button class="secondary" type="button">强制重新抓取</button>
          </div>
        </form>"""

PASTE_DISABLED = """
        <form class="paste-reread is-disabled">
          <label>原文全文
            <textarea name="pastedText" rows="4" disabled placeholder="把原文全文粘贴到这里"></textarea>
          </label>
          <p class="muted">深读进行中，完成前不能再次提交。</p>
        </form>"""


def page(state_id: str, state_label: str, status: str, actions: str, banner: str, surface: str, inspector: str) -> str:
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{TITLE} · researcher</title>
  <link rel="stylesheet" href="{CSS_APP}">
  <link rel="stylesheet" href="./mockup.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="#">researcher</a>
  <span class="root">/tmp/researcher-l1-212</span>
  <nav class="topnav" aria-label="Primary">
    <a class="nav-link active" href="#">Library</a>
    <a class="nav-link" href="#">Topics</a>
  </nav>
</header>
<main class="paper-detail-shell document-detail">
  <section class="paper-detail-main">
    <header class="document-header">
      <a class="document-back" href="#">← Library</a>
      <h1>{TITLE}</h1>
      <div class="document-meta"><span>博客</span><span>2026-10-04</span><span>{status}</span></div>
      <div class="document-tools">
        <div class="document-actions">
          <a class="secondary paper-jump-notes" href="#annotations">文档批注</a>
          {actions}
        </div>
        <div class="document-topic-summary"><span class="muted">尚未关联 topic</span></div>
      </div>
      {banner}
    </header>
    {surface}
    <section class="detail-panel paper-notes-panel" id="annotations">
      <div class="paper-notes-head">
        <h2>文档批注</h2>
        <span class="muted">记录你的思考，重新深读后仍保留</span>
      </div>
      <ul class="paper-note-list"><li class="muted paper-note-empty">尚无文档批注，记录值得记住的内容。</li></ul>
    </section>
  </section>
  {inspector}
</main>
<div class="wireframe-tag">L1 #{state_id} · {state_label}</div>
</body>
</html>
"""


STATES = {
    "01-normal-read": page(
        "01",
        "正常已深读",
        "已深读",
        '<form class="deep-read-form"><button class="primary" type="button">重新深读</button></form>',
        "",
        """
    <section class="reader read-surface paper-doc" id="read">
      <dl class="fm paper-identity-fm">
        <div class="wide"><dt>来源</dt><dd>https://every.to/p/codex-graded-my-ai-habits-then-it-became-my-coach</dd></div>
        <div><dt>抽取</dt><dd>Readability · 正文 12,480 字 / 2,110 词</dd></div>
        <div><dt>标签</dt><dd><span class="muted">无</span></dd></div>
      </dl>
      <h2>Essence</h2>
      <p>把一次评级变成每周复盘，用编排器和专项 agent 把个人工作从单线程对话推到可重复的协作。</p>
    </section>""",
        INSPECTOR_READ,
    ),
    "02-failed-too-short": page(
        "02",
        "抽取过短",
        "深读失败",
        "",
        f"""
      <div class="read-status-panel stale is-failure" role="status">
        <div class="read-status-copy"><span class="stale-dot"></span><div>
          <b>深读失败</b>
          <p>抽取正文过短，可能是付费墙或页面结构干扰。只得到 82 字 / 12 词（门槛 1000 字或 150 词）。</p>
          <p>可从原文复制全文，粘贴后重新深读。</p>
          <div class="extract-metrics"><span>82 字</span><span>12 词</span><span>Readability 未过门槛，已回退旧抽取</span></div>
        </div></div>
        {PASTE_OK.format(secondary='<button class="secondary" type="button">强制重新抓取</button>')}
      </div>""",
        """
    <section class="reader read-surface paper-doc" id="read">
      <dl class="fm paper-identity-fm">
        <div class="wide"><dt>来源</dt><dd>https://every.to/p/codex-graded-my-ai-habits-then-it-became-my-coach</dd></div>
        <div><dt>标签</dt><dd><span class="muted">无</span></dd></div>
      </dl>
      <div class="read-empty"><p class="muted">尚无深读产物。</p></div>
    </section>""",
        INSPECTOR_FAILED,
    ),
    "03-fetch-error": page(
        "03",
        "抓取失败",
        "深读失败",
        "",
        f"""
      <div class="read-status-panel stale is-failure" role="status">
        <div class="read-status-copy"><span class="stale-dot"></span><div>
          <b>深读失败</b>
          <p>抓取失败。网络超时。</p>
          <p>可从原文复制全文，粘贴后重新深读。</p>
        </div></div>
        <details class="read-run-details"><summary>运行详情</summary>
          <pre class="library-read-log">url fetch failed: fetch failed: UND_ERR_CONNECT_TIMEOUT for https://every.to/p/codex-graded-my-ai-habits-then-it-became-my-coach</pre>
        </details>
        {PASTE_OK.format(secondary='<button class="secondary" type="button">重试深读</button>')}
      </div>""",
        """
    <section class="reader read-surface paper-doc" id="read">
      <div class="read-empty"><p class="muted">尚无深读产物。</p></div>
    </section>""",
        INSPECTOR_FAILED,
    ),
    "04-rereading": page(
        "04",
        "重新深读进行中",
        "深读中",
        "",
        f"""
      <div class="read-status-panel is-progress-with-paste" role="status" aria-live="polite">
        <div class="read-status-copy"><span class="pulse-dot"></span><div>
          <b>深读中</b>
          <p>正在提取内容并生成深读产物。</p>
        </div></div>
        <details class="read-run-details"><summary>运行详情</summary>
          <ol class="run-stages library-read-stages">
            <li class="active"><span class="mk">↻</span>获取来源</li>
            <li class="pending"><span class="mk">·</span>撰写深读产物</li>
            <li class="pending"><span class="mk">·</span>写入 Library 状态</li>
          </ol>
        </details>
        {PASTE_DISABLED}
      </div>""",
        """
    <section class="reader read-surface paper-doc" id="read">
      <div class="read-empty"><p class="muted">尚无深读产物。</p></div>
    </section>""",
        INSPECTOR_READING,
    ),
    "05-paste-too-short": page(
        "05",
        "粘贴过短校验",
        "深读失败",
        "",
        f"""
      <div class="read-status-panel stale is-failure" role="status">
        <div class="read-status-copy"><span class="stale-dot"></span><div>
          <b>深读失败</b>
          <p>抽取正文过短，可能是付费墙或页面结构干扰。只得到 82 字 / 12 词（门槛 1000 字或 150 词）。</p>
          <p>可从原文复制全文，粘贴后重新深读。</p>
          <div class="extract-metrics"><span>82 字</span><span>12 词</span></div>
        </div></div>
        {PASTE_SHORT}
      </div>""",
        """
    <section class="reader read-surface paper-doc" id="read">
      <div class="read-empty"><p class="muted">尚无深读产物。</p></div>
    </section>""",
        INSPECTOR_FAILED,
    ),
    "06-paste-success": page(
        "06",
        "粘贴成功",
        "已深读",
        '<form class="deep-read-form"><button class="primary" type="button">重新深读</button></form>',
        "",
        """
    <section class="reader read-surface paper-doc" id="read">
      <dl class="fm paper-identity-fm">
        <div class="wide"><dt>来源</dt><dd>https://every.to/p/codex-graded-my-ai-habits-then-it-became-my-coach</dd></div>
        <div class="wide"><dt>来源</dt><dd><span class="source-origin">用户粘贴</span></dd></div>
        <div><dt>抽取</dt><dd>用户粘贴 · 正文 14,210 字 / 2,430 词</dd></div>
        <div><dt>标签</dt><dd><span class="muted">无</span></dd></div>
      </dl>
      <h2>Essence</h2>
      <p>用粘贴全文生成的深读产物。身份表标明来源是用户粘贴，而不是这次抓取到的残页。</p>
    </section>""",
        INSPECTOR_READ,
    ),
}


def main() -> None:
    for name, html in STATES.items():
        path = HERE / f"{name}.html"
        path.write_text(html, encoding="utf-8")
        print(path)


if __name__ == "__main__":
    main()
