/**
 * Structured logging (SECURITY.md §7).
 *
 * The rule this module exists to enforce: **financial values never reach a
 * log**. Balances, amounts, holdings and net worth are the product; a log line
 * is an operational record. Keeping them apart is what lets logs be shipped,
 * tailed and retained without the retention policy becoming a financial-data
 * question.
 *
 * `redact()` is applied to every field of every log call, so obeying the rule
 * is the default rather than something each call site must remember.
 */

import { env } from '../lib/env';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * Keys whose values are never emitted. Matched case-insensitively against the
 * whole key, so `amount`, `baseAmount` and `opening_balance` are all caught.
 */
const REDACTED_KEY = /(password|secret|token|api[-_]?key|authorization|cookie|totp|recovery|hash|salt|balance|amount|minor|net_?worth|holding|quantity|price|cost_?basis|pnl|iv|ciphertext)/i;

const MAX_STRING = 512;

export type LogFields = Record<string, unknown>;

/**
 * Replace anything that looks like a credential or a financial figure with a
 * marker. Structure is preserved so a log line still shows which fields were
 * present — useful for debugging, and it reveals nothing.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[depth]';

  switch (typeof value) {
    case 'string':
      return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      // A bigint in this codebase is a monetary or quantity value by construction.
      return '[redacted]';
    case 'function':
      return '[function]';
    default:
      break;
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '[redacted]';

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redact(v, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEY.test(key) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function enabled(level: LogLevel): boolean {
  let configured: LogLevel = 'info';
  try {
    configured = env().LOG_LEVEL;
  } catch {
    // Logging must work even when the environment is invalid — that failure is
    // itself something worth logging.
  }
  return LEVEL_ORDER[level] <= LEVEL_ORDER[configured];
}

function emit(level: LogLevel, message: string, fields: LogFields): void {
  if (!enabled(level)) return;

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(redact(fields) as LogFields),
  });

  // The transport is stdout/stderr: the process manager owns collection and
  // rotation. No logging SaaS, per SECURITY.md §11.
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else process.stdout.write(`${line}\n`);
}

export interface Logger {
  error(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  /** A child logger whose fields are merged into every line — typically `{ correlationId }`. */
  with(fields: LogFields): Logger;
}

function build(bound: LogFields): Logger {
  return {
    error: (m, f) => emit('error', m, { ...bound, ...f }),
    warn: (m, f) => emit('warn', m, { ...bound, ...f }),
    info: (m, f) => emit('info', m, { ...bound, ...f }),
    debug: (m, f) => emit('debug', m, { ...bound, ...f }),
    with: (f) => build({ ...bound, ...f }),
  };
}

export const log: Logger = build({});

/**
 * The identifier shown to the user when something breaks, and the one written
 * to the log beside the stack trace. It is how "it said error 4f2a91c8" becomes
 * a specific line in a specific request (ARCHITECTURE.md §7).
 */
export function newCorrelationId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}
