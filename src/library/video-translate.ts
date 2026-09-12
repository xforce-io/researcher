import type { VideoCue } from './model.js';

const CJK = /[\u4e00-\u9fff]/;
const CHUNK = 40;
export const TRANSLATE_REQUEST_TIMEOUT_MS = 20_000;
export const TRANSLATE_STAGE_BUDGET_MS = 120_000;

export type CueTranslator = (texts: string[]) => Promise<string[]>;

export function parseJsonStringArray(raw: string, expected: number): string[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('translator did not return a JSON array');
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed) || parsed.length !== expected) {
    throw new Error(`translator array length ${Array.isArray(parsed) ? parsed.length : 'n/a'} != ${expected}`);
  }
  return parsed.map((x) => String(x ?? '').trim());
}

export async function attachChineseCues(
  cues: VideoCue[],
  translate: CueTranslator,
  opts?: { now?: () => number; budgetMs?: number },
): Promise<VideoCue[]> {
  if (!cues.length) return cues;
  if (cues.every((c) => CJK.test(c.text))) return cues;
  const need = cues.map((c) => (CJK.test(c.text) ? '' : c.text));
  const toSend = need.filter(Boolean);
  if (!toSend.length) return cues;
  const now = opts?.now ?? Date.now;
  const budget = opts?.budgetMs ?? TRANSLATE_STAGE_BUDGET_MS;
  const started = now();
  const translated: string[] = [];
  for (let i = 0; i < toSend.length; i += CHUNK) {
    const remain = started + budget - now();
    if (remain <= 0) break;
    const chunk = toSend.slice(i, i + CHUNK);
    const part = await raceTranslate(translate, chunk, Math.min(remain, TRANSLATE_REQUEST_TIMEOUT_MS));
    if (!part) break;
    translated.push(...part);
  }
  let k = 0;
  return cues.map((c, i) => {
    if (!need[i]) return c;
    if (k >= translated.length) return c;
    const zh = translated[k++] || '';
    return zh ? { ...c, zh } : c;
  });
}

function raceTranslate(
  translate: CueTranslator,
  chunk: string[],
  ms: number,
): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string[] | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), Math.max(0, ms));
    translate(chunk).then(
      (part) => {
        clearTimeout(timer);
        finish(Array.isArray(part) && part.length === chunk.length ? part : undefined);
      },
      () => {
        clearTimeout(timer);
        finish(undefined);
      },
    );
  });
}

function translatorClients(): Array<{ name: string; apiKey: string; baseURL: string; model: string }> {
  const env = process.env;
  const out: Array<{ name: string; apiKey: string; baseURL: string; model: string }> = [];
  if (env.VOLCENGINE_TOKEN && env.VOLCENGINE_API_BASE) {
    out.push({
      name: 'volcengine',
      apiKey: env.VOLCENGINE_TOKEN,
      baseURL: env.VOLCENGINE_API_BASE,
      model: env.VIDEO_TRANSLATE_MODEL || env.VOLCENGINE_MODEL || env.RESEARCHER_LIBRARY_READ_MODEL || 'glm-latest',
    });
  }
  if (env.DEEPSEEK_API_KEY) {
    out.push({
      name: 'deepseek',
      apiKey: env.DEEPSEEK_API_KEY,
      baseURL: env.DEEPSEEK_API_BASE || 'https://api.deepseek.com',
      model: env.VIDEO_TRANSLATE_MODEL || 'deepseek-chat',
    });
  }
  if (env.XAI_API_KEY) {
    out.push({
      name: 'xai',
      apiKey: env.XAI_API_KEY,
      baseURL: 'https://api.x.ai/v1',
      model: env.XAI_TRANSLATE_MODEL || env.XAI_MODEL || 'grok-4-fast-non-reasoning',
    });
  }
  return out;
}

export async function defaultTranslateToZh(texts: string[]): Promise<string[]> {
  if (!texts.length) return [];
  const OpenAI = (await import('openai')).default;
  const errors: string[] = [];
  for (const cfg of translatorClients()) {
    try {
      const client = new OpenAI({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL,
        maxRetries: 0,
        timeout: TRANSLATE_REQUEST_TIMEOUT_MS,
      });
      const raw = await client.chat.completions.create({
        model: cfg.model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: '将用户给出的 JSON 字符串数组逐项译为简体中文。只返回同样长度的 JSON 字符串数组，不要 markdown。专有名词（Cursor、Benny、Grok、PR）可保留原文。',
          },
          { role: 'user', content: JSON.stringify(texts) },
        ],
      }, { signal: AbortSignal.timeout(TRANSLATE_REQUEST_TIMEOUT_MS) });
      const content = raw.choices?.[0]?.message?.content ?? '';
      return parseJsonStringArray(content, texts.length);
    } catch (err) {
      errors.push(`${cfg.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!translatorClients().length) return texts.map(() => '');
  throw new Error(`translate failed (${errors.join('; ')})`);
}
