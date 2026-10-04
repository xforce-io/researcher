#!/usr/bin/env node
/**
 * Standalone smoke for #212. After `npm ci && npm run build` in a clean clone:
 *   RESEARCHER_HOME=/tmp/r-home node scripts/smoke-212-url-extract.mjs
 *   node scripts/smoke-212-url-extract.mjs --cache-dir /tmp/r-home
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cacheFlag = process.argv.indexOf('--cache-dir');
const envHome = process.env.RESEARCHER_HOME;
const cacheDir = cacheFlag >= 0
  ? resolve(process.argv[cacheFlag + 1] ?? '')
  : (envHome || mkdtempSync(join(tmpdir(), 'researcher-smoke-212-')));
const createdCache = cacheFlag < 0 && !envHome;
process.env.RESEARCHER_HOME = cacheDir;

const distExtract = join(root, 'dist/sources/url-extract.js');
const distFetch = join(root, 'dist/sources/url-fetch.js');
const fixture = join(root, 'tests/fixtures/url-extract/everyto-codex-graded.html');

const { extractHtmlArticle, UrlExtractError, countBodyStats } = await import(pathToFileURL(distExtract).href);
const { fetchUrlMaterial } = await import(pathToFileURL(distFetch).href);

const html = readFileSync(fixture, 'utf8');
const extracted = extractHtmlArticle(html);
const stats = countBodyStats(extracted.text);
if (!['readability', 'dom-fallback'].includes(extracted.extractionMethod)) {
  throw new Error(`unexpected extractionMethod: ${extracted.extractionMethod}`);
}
if (stats.chars < 1000) {
  throw new Error(`every.to fixture too short: ${stats.chars} chars via ${extracted.extractionMethod}`);
}
if (!/blank slate/i.test(extracted.text) || !/Eight Levels/i.test(extracted.text)) {
  throw new Error('every.to fixture missed expected prose');
}
if (extracted.extractionMethod === 'dom-fallback' && /^Vibe Check: GPT-5\.6 Sol/.test(extracted.text)) {
  throw new Error('dom-fallback selected the related-essay rec card');
}

let shortFailed = false;
try {
  extractHtmlArticle('<html><body><p>tiny</p></body></html>');
} catch (err) {
  shortFailed = err instanceof UrlExtractError && err.failureCode === 'extract_too_short';
}
if (!shortFailed) throw new Error('expected extract_too_short on a tiny page');

const page = `<!doctype html><html><head><title>Smoke</title></head><body><article>${extracted.text}</article></body></html>`;
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/post`;
try {
  const first = await fetchUrlMaterial(`url:${url}`);
  const second = await fetchUrlMaterial(`url:${url}`);
  if (first.text.length < 1000 || second.text.length < 1000) {
    throw new Error('fetchUrlMaterial smoke extract too short');
  }
  const third = await fetchUrlMaterial(`url:${url}`, { forceRefetch: true });
  if (third.text.length < 1000) throw new Error('forceRefetch smoke extract too short');
} finally {
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  if (createdCache) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

process.stdout.write([
  `node ${process.version}`,
  `extractionMethod ${extracted.extractionMethod}`,
  `chars ${stats.chars} words ${stats.words}`,
  `cacheDir ${cacheDir}`,
  'ok',
].join('\n') + '\n');
