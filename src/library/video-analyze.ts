import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execa, execaSync } from 'execa';
import { normalizeCues } from './video.js';
import type { VideoCue } from './model.js';

export type VideoAnalyzeRunner = (opts: {
  mediaPath: string;
  workDir: string;
}) => Promise<{ cues: VideoCue[] }>;

function which(cmd: string): string | undefined {
  try {
    return execaSync(process.platform === 'win32' ? 'where' : 'which', [cmd]).stdout.trim().split('\n')[0];
  } catch {
    return undefined;
  }
}

export function analyzeRuntime(): { ffmpeg?: string; whisper?: string; missing: string[] } {
  const ffmpeg = which('ffmpeg');
  const whisper = which('mlx_whisper') || which('whisper');
  const missing: string[] = [];
  if (!ffmpeg) missing.push('ffmpeg');
  if (!whisper) missing.push('mlx_whisper');
  return { ffmpeg, whisper, missing };
}

export const defaultVideoAnalyzeRunner: VideoAnalyzeRunner = async ({ mediaPath, workDir }) => {
  const runtime = analyzeRuntime();
  if (runtime.missing.length) {
    const missing = runtime.missing.join(' and ');
    throw Object.assign(new Error(`${missing} not found on PATH`), { status: 503, command: runtime.missing[0] });
  }
  mkdirSync(workDir, { recursive: true });
  const audio = join(workDir, 'audio.wav');
  try {
    await execa(runtime.ffmpeg!, ['-y', '-i', mediaPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio]);
  } catch (err) {
    throw Object.assign(new Error(`ffmpeg failed: ${err instanceof Error ? err.message : String(err)}`), {
      command: 'ffmpeg',
    });
  }
  const outName = 'transcript';
  try {
    await execa(runtime.whisper!, [
      '--output-dir', workDir,
      '--output-name', outName,
      '--output-format', 'json',
      '--word-timestamps', 'False',
      audio,
    ]);
  } catch (err) {
    throw Object.assign(new Error(`${runtime.whisper} failed: ${err instanceof Error ? err.message : String(err)}`), {
      command: runtime.whisper,
    });
  }
  const { readFileSync } = await import('node:fs');
  const raw = JSON.parse(readFileSync(join(workDir, `${outName}.json`), 'utf8')) as {
    segments?: Array<{ start?: number; end?: number; text?: string }>;
  };
  return { cues: normalizeCues(raw.segments) };
};
