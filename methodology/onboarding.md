---
version: 1
target_files:
  - project.yaml
  - thesis.md
---

# Onboarding Questions

Style guide for the rewrite step:
- Preserve user intent verbatim — never invent facts the user did not state.
- Tighten verbose answers into the methodology's voice (declarative, falsifiable, concrete).
- For YAML fields, output valid YAML.
- For the thesis `## Working thesis` section: write one substantive paragraph per working hypothesis (Q7). Each paragraph must name the specific claim, the mechanism or evidence threshold, and the falsification condition. Do NOT compress into a summary — expand into a position. Aim for 3–5 paragraphs.
- For the thesis `## Design Context` section: if Q8 was answered, write 3–5 concrete sentences naming the artifact, current gap, and success criterion. If Q8 was skipped, omit this section entirely.
- If a question was skipped, leave the corresponding template content untouched and append a `# TODO: revisit after first few papers` comment on the relevant line.

## Q1 — topic_oneline
Required: true
Field: project.yaml > meta.topic_oneline
Question: "Describe your topic in one sentence — what is the artifact, who is the decision-maker, what's at stake?"
Style: declarative, concrete, name a domain.
Examples (good):
- "Decision-making policies inside LLM agents — when an agent should ask, plan, act, or escalate."
- "Trace-level observability signals for production AI agents."
Examples (bad):
- "AI agents." (too broad)
- "Decision agent stuff." (vague)

## Q2 — research_questions
Required: true
Field: project.yaml > research_questions[]
Question: "List 2-4 falsifiable research questions. Each should start with 'How' / 'When' / 'Whether'."
Min: 2
Max: 4
Style: each question must be answerable by reading papers; avoid yes/no questions about future predictions.
Examples (good):
- "How do current agent frameworks decide between asking the user vs acting autonomously?"
- "Whether decision-quality benchmarks correlate with deployment outcomes."
Examples (bad):
- "What is the future of AI?" (not falsifiable)
- "Is GPT-5 better at decisions?" (not literature-driven)

## Q3 — inclusion_criteria
Required: false
Field: project.yaml > inclusion_criteria[]
Question: "What must a paper have to be worth deep-reading?"
Style: concrete, observable signals.

## Q4 — exclusion_criteria
Required: false
Field: project.yaml > exclusion_criteria[]; thesis.md > `## Anti-patterns`
Question: "What kinds of papers do you intentionally reject?"
Style: name the failure mode, not the surface keyword.

## Q5 — taste
Required: false
Field: thesis.md > `## Taste`
Question: "List 3-5 preferences for what counts as a 'good' paper in this topic."
Min: 3
Max: 5
Style: each should be opinionated and falsifiable by a counter-example.

## Q6 — seed_keywords
Required: false
Field: project.yaml > sources[0].queries[]
Question: "What arXiv search keywords would surface the right papers?"
Min: 2
Max: 6
Style: 2-6 concrete phrases; avoid single common words.

## Q7 — working_hypotheses
Required: false
Field: thesis.md > ## Working thesis
Question: "For each RQ you listed, state your current best answer in 2-4 sentences. Must be falsifiable — name a threshold, mechanism, or counter-example that would change your view."
Style: declarative claims, not hedges. Take a position even if uncertain.
Examples (good):
- "Lightweight signal-based triage achieves >70% informativeness at <1% the cost of LLM-as-Judge; this breaks if the corpus is synthetic or single-turn."
- "Decision agent workers fail at tasks requiring >5 sequential steps because step-by-step LLM reasoning is structurally equivalent to greedy search; MCTS-class methods fix planning depth but add latency."
Examples (bad):
- "I think X might be important." (no falsifiable claim)
- "It depends on the use case." (no position taken)

## Q8 — design_anchor
Required: false
Field: thesis.md > ## Design Context
Question: "What are you actually trying to build or decide? Name the artifact, the specific gap you're filling today, and what success looks like in 3 months."
Style: concrete. Name the component, current state, and target state.
Examples (good):
- "Building a Triage Agent prototype for KWeaver. Gap: no mechanism to turn production traces into BKN patch suggestions. Success: prototype auto-flags top 10% most learnable trajectories per week."
- "Deciding whether decision agent workers should be stateless independent agents or stateful sub-sessions of openclaw. Success: a clear recommendation backed by evidence on standalone task completion rates."
Examples (bad):
- "Researching decision agents." (no design decision, no gap)
- "Learning about the space." (not actionable)
