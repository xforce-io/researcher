import { describe, expect, it } from 'vitest';
import {
  AgentConnectionError,
  resolveAgentConnection,
} from '../../src/config/agent-connection.js';

function expectCode(fn: () => unknown, code: string, fields?: string[]): AgentConnectionError {
  try {
    fn();
    throw new Error('expected AgentConnectionError');
  } catch (err) {
    expect(err).toBeInstanceOf(AgentConnectionError);
    const typed = err as AgentConnectionError;
    expect(typed.code).toBe(code);
    if (fields) expect(typed.fields).toEqual(fields);
    return typed;
  }
}

describe('resolveAgentConnection', () => {
  it('selects the host milkie orchestrator when config is empty', () => {
    expect(resolveAgentConnection({})).toEqual({ kind: 'milkie' });
  });

  it('selects host milkie without calling contract runtime', () => {
    expect(resolveAgentConnection({ runtime: 'milkie' })).toEqual({ kind: 'milkie' });
  });

  it('maps legacy grok-cli yaml to the grok-cli adapter', () => {
    expect(resolveAgentConnection({ runtime: 'grok-cli' })).toEqual({ kind: 'grok-cli' });
  });

  it('accepts canonical agent-cli grok-cli', () => {
    expect(resolveAgentConnection({
      transport: 'agent-cli',
      runtime: 'grok-cli',
    })).toEqual({ kind: 'grok-cli' });
  });

  it('rejects transport=api before any adapter is chosen', () => {
    expectCode(
      () => resolveAgentConnection({
        transport: 'api',
        protocol: 'openai-chat-completions',
        model: 'glm-latest',
        apiKey: 'secret',
      }),
      'CONNECTION_CONFIG_CONFLICT',
      ['transport'],
    );
  });

  it('rejects protocol on agent-cli', () => {
    expectCode(
      () => resolveAgentConnection({
        transport: 'agent-cli',
        runtime: 'grok-cli',
        protocol: 'openai-chat-completions',
      }),
      'CONNECTION_CONFIG_CONFLICT',
      ['protocol'],
    );
  });

  it('rejects protocol on host milkie', () => {
    expectCode(
      () => resolveAgentConnection({
        runtime: 'milkie',
        protocol: 'openai-chat-completions',
      }),
      'CONNECTION_CONFIG_CONFLICT',
      ['protocol'],
    );
  });

  it('rejects milkie as a contract runtime', () => {
    expectCode(
      () => resolveAgentConnection({
        transport: 'agent-cli',
        runtime: 'milkie',
      }),
      'CONNECTION_CONFIG_UNKNOWN_VALUE',
      ['runtime'],
    );
  });

  it('rejects unimplemented contract runtimes', () => {
    expectCode(
      () => resolveAgentConnection({
        transport: 'agent-cli',
        runtime: 'claude-code',
      }),
      'CONNECTION_CONFIG_UNKNOWN_VALUE',
      ['runtime'],
    );
    expectCode(
      () => resolveAgentConnection({
        transport: 'agent-cli',
        runtime: 'codex',
      }),
      'CONNECTION_CONFIG_UNKNOWN_VALUE',
      ['runtime'],
    );
  });

  it('rejects missing runtime on agent-cli', () => {
    expectCode(
      () => resolveAgentConnection({ transport: 'agent-cli' }),
      'CONNECTION_CONFIG_MISSING_FIELD',
      ['runtime'],
    );
  });

  it('does not map old milkie to agent-cli', () => {
    expect(resolveAgentConnection({ runtime: 'milkie' }).kind).toBe('milkie');
  });

  it('expires legacy grok-cli without transport at contract_version 2', () => {
    expectCode(
      () => resolveAgentConnection({ runtime: 'grok-cli', contract_version: 2 }),
      'CONNECTION_CONFIG_LEGACY_EXPIRED',
      ['runtime'],
    );
  });
});
