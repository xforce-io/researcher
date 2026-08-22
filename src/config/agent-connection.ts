/** Host mapping + milkie agent-cli parseFields slice. Do not assemble HTTP gateways. */

export type AgentConnectionKind = 'milkie' | 'grok-cli';

export type AgentConnectionCode =
  | 'CONNECTION_CONFIG_MISSING_FIELD'
  | 'CONNECTION_CONFIG_CONFLICT'
  | 'CONNECTION_CONFIG_UNKNOWN_VALUE'
  | 'CONNECTION_CONFIG_LEGACY_EXPIRED';

const MESSAGES: Record<AgentConnectionCode, string> = {
  CONNECTION_CONFIG_MISSING_FIELD: 'Model connection configuration is missing a required field.',
  CONNECTION_CONFIG_CONFLICT: 'Model connection configuration has conflicting fields.',
  CONNECTION_CONFIG_UNKNOWN_VALUE: 'Model connection configuration contains an unknown or blank value.',
  CONNECTION_CONFIG_LEGACY_EXPIRED: 'Legacy model connection configuration is outside the migration window.',
};

const TRANSPORTS: Record<string, true> = { api: true, 'agent-cli': true };
const PROTOCOLS: Record<string, true> = {
  'anthropic-messages': true,
  'openai-chat-completions': true,
};
const RUNTIMES: Record<string, true> = { 'claude-code': true, 'grok-cli': true, codex: true };
const CONTRACT_FIELDS = ['transport', 'protocol', 'runtime', 'model', 'baseUrl', 'apiKey', 'provider'] as const;

type ContractField = (typeof CONTRACT_FIELDS)[number];

export interface AgentConnectionFields {
  transport?: string;
  protocol?: string;
  runtime?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  provider?: string;
  contract_version?: number;
}

export class AgentConnectionError extends Error {
  readonly code: AgentConnectionCode;
  readonly fields: string[];

  constructor(code: AgentConnectionCode, fields: string[]) {
    const unique = [...new Set(fields)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    super(MESSAGES[code]);
    this.name = 'AgentConnectionError';
    this.code = code;
    this.fields = unique;
  }
}

function fail(code: AgentConnectionCode, fields: string[]): never {
  throw new AgentConnectionError(code, fields);
}

function isBlank(value: string): boolean {
  return value.length === 0 || value !== value.trim();
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** milkie parseFields for the fields we actually send. */
function parseFields(fields: AgentConnectionFields): void {
  const blank: string[] = [];
  for (const name of CONTRACT_FIELDS) {
    const value = fields[name];
    if (value !== undefined && isBlank(value)) blank.push(name);
  }
  if (blank.length > 0) fail('CONNECTION_CONFIG_UNKNOWN_VALUE', blank);

  const unknownEnum: string[] = [];
  if (fields.transport !== undefined && !TRANSPORTS[fields.transport]) unknownEnum.push('transport');
  if (fields.protocol !== undefined && !PROTOCOLS[fields.protocol]) unknownEnum.push('protocol');
  if (fields.runtime !== undefined && !RUNTIMES[fields.runtime]) unknownEnum.push('runtime');
  if (unknownEnum.length > 0) fail('CONNECTION_CONFIG_UNKNOWN_VALUE', unknownEnum);

  const conflicts: string[] = [];
  if (fields.transport === 'api' && fields.runtime !== undefined) conflicts.push('runtime');
  if (fields.transport === 'agent-cli') {
    if (fields.protocol !== undefined) conflicts.push('protocol');
    if (fields.apiKey !== undefined) conflicts.push('apiKey');
    if (fields.baseUrl !== undefined) conflicts.push('baseUrl');
  }
  if (conflicts.length > 0) fail('CONNECTION_CONFIG_CONFLICT', conflicts);

  const missing: string[] = [];
  if (fields.transport === undefined) missing.push('transport');
  if (fields.transport === 'api') {
    if (fields.protocol === undefined) missing.push('protocol');
    if (fields.model === undefined) missing.push('model');
    if (fields.apiKey === undefined) missing.push('apiKey');
  }
  if (fields.transport === 'agent-cli' && fields.runtime === undefined) missing.push('runtime');
  if (missing.length > 0) fail('CONNECTION_CONFIG_MISSING_FIELD', missing);
}

function contractFieldsFrom(config: AgentConnectionFields): AgentConnectionFields {
  const fields: AgentConnectionFields = {};
  for (const name of CONTRACT_FIELDS) {
    const value = config[name];
    if (value !== undefined) fields[name] = value;
  }
  return fields;
}

function acceptGrokCli(fields: AgentConnectionFields): { kind: 'grok-cli' } {
  parseFields(fields);
  if (fields.transport === 'api') fail('CONNECTION_CONFIG_CONFLICT', ['transport']);
  if (fields.runtime !== 'grok-cli') fail('CONNECTION_CONFIG_UNKNOWN_VALUE', ['runtime']);
  return { kind: 'grok-cli' };
}

export function resolveAgentConnection(config: AgentConnectionFields): { kind: AgentConnectionKind } {
  const version = config.contract_version ?? 1;
  if (!isWholeNumber(version) || version < 1) fail('CONNECTION_CONFIG_UNKNOWN_VALUE', ['contractVersion']);

  if (config.transport === undefined) {
    const runtime = config.runtime;
    if (runtime === undefined || runtime === 'milkie') {
      const extras: string[] = [];
      if (config.protocol !== undefined) extras.push('protocol');
      if (config.apiKey !== undefined) extras.push('apiKey');
      if (config.baseUrl !== undefined) extras.push('baseUrl');
      if (extras.length > 0) fail('CONNECTION_CONFIG_CONFLICT', extras);
      if (runtime !== undefined && isBlank(runtime)) fail('CONNECTION_CONFIG_UNKNOWN_VALUE', ['runtime']);
      return { kind: 'milkie' };
    }
    if (runtime === 'grok-cli') {
      if (version >= 2) fail('CONNECTION_CONFIG_LEGACY_EXPIRED', ['runtime']);
      return acceptGrokCli({
        ...contractFieldsFrom(config),
        transport: 'agent-cli',
        runtime: 'grok-cli',
      });
    }
    fail('CONNECTION_CONFIG_UNKNOWN_VALUE', ['runtime']);
  }

  return acceptGrokCli(contractFieldsFrom(config));
}
