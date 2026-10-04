#!/usr/bin/env node
/**
 * Standalone smoke for #212. After `npm ci && npm run build` in a clean clone:
 *   node scripts/smoke-212-url-extract.mjs --cache-dir /tmp/r-home
 *   node scripts/smoke-212-url-extract.mjs --cache-dir /tmp/r-home https://every.to/...
 *
 * Default URL is a local server that serves the saved every.to fixture.
 * It is NOT live https://every.to/...
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

function say(line) {
  process.stdout.write(`${line}\n`);
}

function fail(message) {
  throw new Error(message);
}

function urlCacheExists(home, canonicalId) {
  const key = createHash('sha256').update(canonicalId).digest('hex').slice(0, 16);
  const dir = join(home, 'cache', 'url');
  return existsSync(join(dir, `${key}.meta.json`)) && existsSync(join(dir, `${key}.txt`));
}

function previewText(text, maxChars = 200) {
  return [...text.replace(/\s+/g, ' ').trim()].slice(0, maxChars).join('');
}

const { cacheDir: cacheFlag, url: requestedUrl } = parseArgs(process.argv.slice(2));
const envHome = process.env.RESEARCHER_HOME;
const cacheDir = cacheFlag || envHome || mkdtempSync(join(tmpdir(), 'researcher-smoke-212-'));
const createdCache = !cacheFlag && !envHome;
process.env.RESEARCHER_HOME = cacheDir;

const mode = requestedUrl ? 'live' : 'local-fixture';
const distExtract = join(root, 'dist/sources/url-extract.js');
const distFetch = join(root, 'dist/sources/url-fetch.js');
const fixture = join(root, 'tests/fixtures/url-extract/everyto-codex-graded.html');

const { extractDomFallback, extractHtmlArticle, UrlExtractError, countBodyStats, isBodyTooShort } = await import(pathToFileURL(distExtract).href);
const { fetchUrlMaterial } = await import(pathToFileURL(distFetch).href);

function reportCall(label, material, cacheKind) {
  const stats = countBodyStats(material.text);
  const chars = material.bodyChars ?? stats.chars;
  const words = material.bodyWords ?? stats.words;
  const gate = isBodyTooShort(material.text) ? 'fail' : 'pass';
  const extractor = material.extractionMethod ?? 'unknown';
  say(`call ${label}`);
  say(`  url ${material.url}`);
  say(`  mode ${mode}`);
  say(`  extractor ${extractor}`);
  say(`  chars ${chars} words ${words}`);
  say(`  gate ${gate}`);
  say(`  cache ${cacheKind}`);
  return { chars, words, gate, extractor, text: material.text, url: material.url };
}

async function fetchAndReport(label, url, opts) {
  const canonicalId = `url:${url}`;
  const cacheKind = opts?.forceRefetch
    ? 'forceRefetch'
    : urlCacheExists(cacheDir, canonicalId) ? 'hit' : 'miss';
  const material = await fetchUrlMaterial(canonicalId, opts);
  return reportCall(label, material, cacheKind);
}

let shortFailed = false;
try {
  extractHtmlArticle('<html><body><p>tiny</p></body></html>');
} catch (err) {
  shortFailed = err instanceof UrlExtractError && err.failureCode === 'extract_too_short';
}
if (!shortFailed) fail('expected extract_too_short on a tiny page');

let usedUrl = requestedUrl;
let fixtureHtml;
let server;
if (mode === 'local-fixture') {
  fixtureHtml = readFileSync(fixture, 'utf8');
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fixtureHtml);
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  usedUrl = `http://127.0.0.1:${port}/`;
}

say(`node ${process.version}`);
say(`mode ${mode}`);
say(`url ${usedUrl}`);
say(`cacheDir ${cacheDir}`);

try {
  const first = await fetchAndReport(1, usedUrl);
  if (first.gate !== 'pass') {
    fail(`gate failed for ${usedUrl}: ${first.chars} chars / ${first.words} words via ${first.extractor}`);
  }

  if (mode === 'local-fixture') {
    if (first.extractor !== 'readability') {
      fail(`fixture expected readability, got ${first.extractor}`);
    }
    if (first.chars !== 2424 || first.words !== 410) {
      fail(`fixture expected 2424/410, got ${first.chars}/${first.words} via ${first.extractor}`);
    }
    if (!/blank slate/i.test(first.text) || !/Eight Levels/i.test(first.text)) {
      fail('fixture missed expected prose');
    }
    const fallback = extractDomFallback(fixtureHtml);
    if (!/blank slate/i.test(fallback.text) || !/Eight Levels/i.test(fallback.text)) {
      fail('dom-fallback missed expected prose');
    }
    if (/^Vibe Check: GPT-5\.6 Sol/.test(fallback.text)) {
      fail('dom-fallback selected the related-essay rec card');
    }
  } else {
    say(`preview ${previewText(first.text, 200)}`);
  }

  const second = await fetchAndReport(2, usedUrl);
  if (second.gate !== 'pass') {
    fail(`cache-hit gate failed for ${usedUrl}: ${second.chars} chars / ${second.words} words`);
  }

  const third = await fetchAndReport(3, usedUrl, { forceRefetch: true });
  if (third.gate !== 'pass') {
    fail(`forceRefetch gate failed for ${usedUrl}: ${third.chars} chars / ${third.words} words`);
  }
} finally {
  if (server) {
    await new Promise((resolveClose, reject) => server.close((err) => err ? reject(err) : resolveClose()));
  }
  if (createdCache) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

say('ok');
