import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { discoverTriage } from '../../src/pipeline/discover_triage.js';
import { newRunId, RunDir } from '../../src/state/runs.js';

type ChatRequest = { tools?: Array<{ function?: { name?: string } }> };
type TraceEvent = { type: string; payload: Record<string, unknown> };
type Trace = { agentId: string; events: TraceEvent[] };

const MILKIE_BIN = process.env.RESEARCHER_CROSS_REPO_MILKIE_CLI;

function hasExecutableMilkieCli(path: string | undefined): path is string {
  if (!path) return false;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const describeCrossRepo = hasExecutableMilkieCli(MILKIE_BIN) ? describe : describe.skip;

const candidates = {
  candidates: [{
    id: 'arxiv:2401.12345',
    title: 'Deterministic candidate',
    url: 'https://arxiv.org/abs/2401.12345',
    abstract: 'A deterministic local-provider candidate.',
    source: 'arxiv',
  }],
  search_summary: 'deterministic fake provider',
};

const triaged = {
  candidates: [{
    id: 'arxiv:2401.12345',
    title: 'Deterministic candidate',
    url: 'https://arxiv.org/abs/2401.12345',
    source: 'arxiv',
    decision: 'skim',
    axes: { relevance: 2, alignment: 'supports', novelty: 'incremental', gravity: 'low' },
    reason: 'Relevant enough for a deterministic triage fixture.',
  }],
  search_summary: 'deterministic fake provider',
};

class FakeOpenAIProvider {
  private server: Server | undefined;
  collectCalls = 0;
  triageCalls = 0;

  async start(candidatesPath: string): Promise<string> {
    const artifact = Buffer.from(JSON.stringify(candidates), 'utf8').toString('base64');
    const writeCandidates = [
      'node -e "require(\'node:fs\').writeFileSync(process.argv[1], Buffer.from(process.argv[2], \'base64\'))"',
      JSON.stringify(candidatesPath),
      artifact,
    ].join(' ');

    this.server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest;
      const toolNames = new Set(body.tools?.map((tool) => tool.function?.name) ?? []);

      res.setHeader('content-type', 'application/json');
      if (toolNames.has('run_command')) {
        this.collectCalls += 1;
        if (this.collectCalls <= 12) {
          res.end(JSON.stringify(toolCallResponse(`collect-${this.collectCalls}`, this.collectCalls === 11 ? writeCandidates : 'true')));
          return;
        }
        res.end(JSON.stringify(textResponse('collection complete')));
        return;
      }

      this.triageCalls += 1;
      res.end(JSON.stringify(textResponse(JSON.stringify(triaged))));
    });

    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('fake provider did not bind a TCP port');
    return `http://127.0.0.1:${address.port}/v1`;
  }

  async stop(): Promise<void> {
    if (this.server) await new Promise<void>((resolve, reject) => this.server!.close((error) => error ? reject(error) : resolve()));
  }
}

function toolCallResponse(id: string, command: string): object {
  return {
    id: `chatcmpl-${id}`,
    object: 'chat.completion',
    created: 0,
    model: 'fake',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id, type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command }) } }],
      },
      finish_reason: 'tool_calls',
    }],
  };
}

function textResponse(content: string): object {
  return {
    id: 'chatcmpl-text',
    object: 'chat.completion',
    created: 0,
    model: 'fake',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}

function configureAgents(projectRoot: string, baseUrl: string, collectBudget: string): void {
  const collectPath = join(projectRoot, 'agents/researcher-collect.md');
  const triagePath = join(projectRoot, 'agents/researcher-triage.md');
  const update = (path: string): void => {
    const source = readFileSync(path, 'utf8');
    writeFileSync(path, source.replace('model: glm-latest', `model: fake\n  baseUrl: ${baseUrl}`));
  };
  update(collectPath);
  update(triagePath);
  writeFileSync(
    collectPath,
    readFileSync(collectPath, 'utf8').replace('max_tool_calls: 12', `max_tool_calls: ${collectBudget}`),
  );
}

function readTraces(projectRoot: string): Trace[] {
  return readdirSync(join(projectRoot, '.milkie/runs'))
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => readFileSync(join(projectRoot, '.milkie/runs', name), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TraceEvent))
    .map((events) => {
      const started = events.find((event) => event.type === 'agent.run.started');
      return { agentId: String(started?.payload.agentId), events };
    });
}

describeCrossRepo('Task 4 cross-repository discover integration', () => {
  const originalMilkieBin = process.env.RESEARCHER_MILKIE_BIN;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalResearcherHome = process.env.RESEARCHER_HOME;
  let projectRoot: string | undefined;
  let provider: FakeOpenAIProvider | undefined;

  afterEach(async () => {
    await provider?.stop();
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
    if (originalMilkieBin === undefined) delete process.env.RESEARCHER_MILKIE_BIN;
    else process.env.RESEARCHER_MILKIE_BIN = originalMilkieBin;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalResearcherHome === undefined) delete process.env.RESEARCHER_HOME;
    else process.env.RESEARCHER_HOME = originalResearcherHome;
    vi.resetModules();
  });

  it('uses the real Milkie CLI budgeted collect run and tool-free triage run', async () => {
    expect(hasExecutableMilkieCli(MILKIE_BIN)).toBe(true);
    projectRoot = mkdtempSync(join(tmpdir(), 'researcher-milkie-117-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: projectRoot });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'researcher-milkie-home-'));
    await runInit({ targetDir: projectRoot });
    await runMethodologyInstall();
    provider = new FakeOpenAIProvider();
    const runDir = new RunDir(join(projectRoot, '.researcher/state/runs'), newRunId());
    const baseUrl = await provider.start(runDir.path('discover-candidates.json'));
    configureAgents(projectRoot, baseUrl, process.env.RESEARCHER_CROSS_REPO_COLLECT_BUDGET ?? '12');

    process.env.RESEARCHER_MILKIE_BIN = MILKIE_BIN!;
    process.env.OPENAI_API_KEY = 'test-only-key';
    vi.resetModules();
    const { MilkieAdapter } = await import('../../src/adapter/milkie.js');
    const ctx = await bootstrap({ projectRoot, adapter: new MilkieAdapter(), runDir });

    await discoverTriage(ctx);

    const traces = readTraces(projectRoot);
    const collectTrace = traces.find((trace) => trace.agentId === 'researcher-collect');
    const triageTrace = traces.find((trace) => trace.agentId === 'researcher-triage');
    expect(collectTrace).toBeDefined();
    expect(triageTrace).toBeDefined();
    const collectRequested = collectTrace!.events.filter((event) => event.type === 'tool.requested');
    const triageRequested = triageTrace!.events.filter((event) => event.type === 'tool.requested');
    const collectBudgetErrors = collectTrace!.events.filter((event) =>
      event.type === 'tool.responded' && (event.payload.error as { code?: string } | undefined)?.code === 'TOOL_CALL_BUDGET_EXCEEDED',
    );

    expect(provider.collectCalls).toBe(13);
    expect(provider.triageCalls).toBe(1);
    expect(collectRequested).toHaveLength(12);
    expect(collectBudgetErrors).toHaveLength(0);
    expect(triageRequested).toHaveLength(0);
    expect(existsSync(runDir.path('triaged.json'))).toBe(true);
  }, 30_000);
});
