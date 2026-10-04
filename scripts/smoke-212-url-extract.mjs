#!/usr/bin/env node
/**
 * Standalone smoke for #212. After `npm ci && npm run build` in a clean clone:
 *   node scripts/smoke-212-url-extract.mjs --cache-dir /tmp/r-home
 *   node scripts/smoke-212-url-extract.mjs --cache-dir /tmp/r-home http://127.0.0.1:PORT/post
 *
 * Default URL is a local server that serves the saved every.to fixture.
 * It is NOT live https://every.to/...
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function parseArgs(argv) {
  const positional = [];
  let cacheDir;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cache-dir') {
      cacheDir = resolve(argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (!arg.startsWith('-')) positional.push(arg);
  }
  return { cacheDir, url: positional[0] };
}

const { cacheDir: cacheFlag, url: requestedUrl } = parseArgs(process.argv.slice(2));
const envHome = process.env.RESEARCHER_HOME;
const cacheDir = cacheFlag || envHome || mkdtempSync(join(tmpdir(), 'researcher-smoke-212-'));
const createdCache = !cacheFlag && !envHome;
process.env.RESEARCHER_HOME = cacheDir;

const distExtract = join(root, 'dist/sources/url-extract.js');
const distFetch = join(root, 'dist/sources/url-fetch.js');
const fixture = join(root, 'tests/fixtures/url-extract/everyto-codex-graded.html');

const { extractHtmlArticle, extractDomFallback, UrlExtractError, countBodyStats } = await import(pathToFileURL(distExtract).href);
const { fetchUrlMaterial } = await import(pathToFileURL(distFetch).href);

const html = readFileSync(fixture, 'utf8');
const extracted = extractHtmlArticle(html);
const stats = countBodyStats(extracted.text);
if (extracted.extractionMethod !== 'readability') {
  throw new Error(`every.to fixture expected readability, got ${extracted.extractionMethod}`);
}
if (stats.chars < 1000) {
  throw new Error(`every.to fixture too short: ${stats.chars} chars via ${extracted.extractionMethod}`);
}
if (!/blank slate/i.test(extracted.text) || !/Eight Levels/i.test(extracted.text)) {
  throw new Error('every.to fixture missed expected prose');
}
const fallback = extractDomFallback(html);
if (!/blank slate/i.test(fallback.text) || !/Eight Levels/i.test(fallback.text)) {
  throw new Error('dom-fallback missed expected prose');
}
if (/^Vibe Check: GPT-5\.6 Sol/.test(fallback.text)) {
  throw new Error('dom-fallback selected the related-essay rec card');
}

let shortFailed = false;
try {
  extractHtmlArticle('<html><body><p>tiny</p></body></html>');
} catch (err) {
  shortFailed = err instanceof UrlExtractError && err.failureCode === 'extract_too_short';
}
if (!shortFailed) throw new Error('expected extract_too_short on a tiny page');

let usedUrl = requestedUrl;
let server;
if (!usedUrl) {
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  usedUrl = `http://127.0.0.1:${port}/`;
}

try {
  const first = await fetchUrlMaterial(`url:${usedUrl}`);
  const second = await fetchUrlMaterial(`url:${usedUrl}`);
  if (first.text.length < 1000 || second.text.length < 1000) {
    throw new Error('fetchUrlMaterial smoke extract too short');
  }
  const third = await fetchUrlMaterial(`url:${usedUrl}`, { forceRefetch: true });
  if (third.text.length < 1000) throw new Error('forceRefetch smoke extract too short');
} finally {
  if (server) {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
  if (createdCache) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

process.stdout.write([
  `node ${process.version}`,
  `extractionMethod ${extracted.extractionMethod}`,
  `chars ${stats.chars} words ${stats.words}`,
  `cacheDir ${cacheDir}`,
  `url ${usedUrl}`,
  `defaultUrl ${requestedUrl ? 'cli' : 'local-fixture (not live every.to)'}`,
  'ok',
].join('\n') + '\n');
