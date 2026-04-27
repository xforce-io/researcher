import { load as parseYaml } from 'js-yaml';

export interface Question {
  id: string;
  fieldId: string;
  required: boolean;
  field: string;
  question: string;
  style?: string;
  min?: number;
  max?: number;
  examplesGood: string[];
  examplesBad: string[];
}

export interface Onboarding {
  version: number;
  targetFiles: string[];
  questions: Question[];
}

interface Frontmatter {
  version: number;
  target_files: string[];
}

export function parseOnboardingMd(src: string): Onboarding {
  const fmMatch = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(src);
  if (!fmMatch) throw new Error('onboarding.md: missing or malformed frontmatter');
  const fm = parseYaml(fmMatch[1]) as Frontmatter;
  if (fm.version !== 1) {
    throw new Error(`onboarding.md: unsupported version ${fm.version} (only 1 is supported)`);
  }
  if (!Array.isArray(fm.target_files) || fm.target_files.length === 0) {
    throw new Error('onboarding.md: target_files must be a non-empty list');
  }

  const body = fmMatch[2];
  const lines = body.split('\n');
  const questions: Question[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Detect any H2 heading to check for bad format
    if (/^## /.test(line)) {
      const h = /^## (Q\d+) — (\w+)\s*$/.exec(line);
      if (!h) {
        throw new Error(
          `onboarding.md: malformed question header at line ${i + 1}: "${line}" (expected format: ## Q<n> — <field_id>)`,
        );
      }
      const id = h[1];
      const fieldId = h[2];
      const startLine = i + 1;
      i++;
      // Collect block until next H2 or EOF
      const blockStart = i;
      while (i < lines.length && !/^## /.test(lines[i])) i++;
      const block = lines.slice(blockStart, i);
      questions.push(parseBlock(id, fieldId, block, startLine));
    } else {
      i++;
    }
  }
  if (questions.length === 0) {
    throw new Error('onboarding.md: no questions found (expected `## Q<n> — <field_id>` headers)');
  }

  return {
    version: fm.version,
    targetFiles: fm.target_files,
    questions,
  };
}

function parseBlock(id: string, fieldId: string, block: string[], baseLine: number): Question {
  const get = (key: string): string | undefined => {
    const m = block.find((l) => l.startsWith(`${key}:`));
    return m?.slice(key.length + 1).trim();
  };

  const requiredRaw = get('Required');
  if (requiredRaw === undefined) {
    throw new Error(`onboarding.md: ${id} (line ${baseLine}) — missing 'Required:' line`);
  }
  const required = requiredRaw === 'true';
  const field = get('Field');
  if (!field) throw new Error(`onboarding.md: ${id} (line ${baseLine}) — missing 'Field:' line`);
  const questionRaw = get('Question');
  if (!questionRaw) throw new Error(`onboarding.md: ${id} (line ${baseLine}) — missing 'Question:' line`);
  const question = questionRaw.replace(/^"|"$/g, '');
  const style = get('Style');
  const min = get('Min') ? Number(get('Min')) : undefined;
  const max = get('Max') ? Number(get('Max')) : undefined;

  const examplesGood = collectExamples(block, 'Examples (good):');
  const examplesBad = collectExamples(block, 'Examples (bad):');

  return { id, fieldId, required, field, question, style, min, max, examplesGood, examplesBad };
}

function collectExamples(block: string[], header: string): string[] {
  const idx = block.findIndex((l) => l.trim() === header);
  if (idx < 0) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < block.length; i++) {
    const m = /^- (.+)$/.exec(block[i]);
    if (!m) break;
    // Strip surrounding quotes if present
    out.push(m[1].replace(/^"|"$/g, '').replace(/" \(.*\)$/, ''));
  }
  return out;
}
