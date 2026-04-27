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
- For YAML fields, output valid YAML; for thesis prose, output 3-6 sentences.
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
Style: 2-6 concrete phrases; avoid single common words.
