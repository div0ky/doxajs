import type { ActorKind, JsonValue, SpanLink } from './index.js'
import { safeDiagnosticError } from './privacy-error.js'

export type ObservationKind =
  | 'execution'
  | 'http'
  | 'action'
  | 'query'
  | 'transaction'
  | 'model'
  | 'event'
  | 'broadcast'
  | 'realtime-command'
  | 'listener'
  | 'reaction'
  | 'signal'
  | 'job'
  | 'schedule'
  | 'authorization'
  | 'cache'
  | 'mail'
  | 'sms'
  | 'log'
  | 'ai.operation'
  | 'ai.tool'
  | 'ai.critic'
  | 'ai.retry'
  | 'exception'

export type ObservationPhase = 'started' | 'completed' | 'failed' | 'occurred'

export interface ObservationContext {
  readonly executionId?: string
  readonly sourceExecutionId?: string
  readonly correlationId?: string
  readonly causationId?: string
  readonly traceId?: string
  readonly spanId?: string
  readonly parentSpanId?: string
  readonly links?: readonly SpanLink[]
  readonly actorKind?: ActorKind
  readonly actorId?: string
  readonly tenantId?: string
  readonly transport?: string
  readonly transportName?: string
}

export interface ObservationError {
  readonly name: string
  readonly message: string
  readonly stack?: string
  readonly cause?: ObservationError
}

export interface ObservationResource {
  readonly application: string
  readonly service: string
  readonly environment: string
  readonly release?: string
  readonly instanceId?: string
}

export interface Observation {
  readonly id: string
  readonly occurredAt: string
  readonly kind: ObservationKind
  readonly name: string
  readonly phase: ObservationPhase
  readonly roleId?: string
  readonly durationMilliseconds?: number
  readonly context: ObservationContext
  readonly resource?: ObservationResource
  readonly attributes: Readonly<Record<string, JsonValue>>
  readonly error?: ObservationError
}

/** Optional observation sink. Implementations must never affect application behavior. */
export abstract class ObservationRecorder {
  abstract record(observation: Observation): void | Promise<void>
}

export class NoopObservationRecorder extends ObservationRecorder {
  record(_observation: Observation): void {}
}

export class MemoryObservationRecorder extends ObservationRecorder {
  readonly observations: Observation[] = []

  record(observation: Observation): void {
    this.observations.push(structuredClone(observation))
  }

  reset(): void {
    this.observations.length = 0
  }
}

export function sanitizeObservationAttributes(
  attributes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, JsonValue>> {
  try {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(attributes).map(([key, value]) => [
          key,
          isSensitiveKey(key, value) ? '[REDACTED]' : sanitizeValue(value, new WeakSet(), 0),
        ]),
      ),
    )
  } catch {
    return Object.freeze({ observationError: 'attributes_unavailable' })
  }
}

export function sanitizeObservationError(error: unknown): ObservationError {
  try {
    return sanitizeError(safeDiagnosticError(error), new Set())
  } catch {
    return Object.freeze({ name: 'Error', message: '[UNAVAILABLE ERROR]' })
  }
}

function sanitizeError(error: unknown, seen: Set<unknown>): ObservationError {
  if (!(error instanceof Error)) {
    return Object.freeze({ name: 'Error', message: redactText(safeString(error)) })
  }
  if (seen.has(error)) {
    return Object.freeze({ name: safeErrorName(error), message: '[CIRCULAR CAUSE]' })
  }
  seen.add(error)
  const message = safeErrorProperty(error, 'message')
  const stack = safeErrorProperty(error, 'stack')
  const cause = safeErrorCause(error)
  return Object.freeze({
    name: safeErrorName(error),
    message: redactText(message ?? '[UNAVAILABLE ERROR MESSAGE]'),
    ...(stack ? { stack: redactText(stack) } : {}),
    ...(cause === undefined ? {} : { cause: sanitizeError(cause, seen) }),
  })
}

function safeErrorName(error: Error): string {
  return safeErrorProperty(error, 'name') || 'Error'
}

function safeErrorProperty(
  error: Error,
  property: 'message' | 'name' | 'stack',
): string | undefined {
  try {
    const value = error[property]
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function safeErrorCause(error: Error): unknown {
  try {
    return error.cause
  } catch {
    return new Error('[UNAVAILABLE CAUSE]')
  }
}

function safeString(value: unknown): string {
  try {
    return String(value)
  } catch {
    return '[UNAVAILABLE ERROR]'
  }
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): JsonValue {
  if (depth > 8) return '[TRUNCATED]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (isSecretString(value)) return '[REDACTED]'
  if (Array.isArray(value))
    return value.slice(0, 100).map((entry) => sanitizeValue(entry, seen, depth + 1))
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  try {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, nested]) => [
          key,
          isSensitiveKey(key, nested) ? '[REDACTED]' : sanitizeValue(nested, seen, depth + 1),
        ]),
    )
  } finally {
    seen.delete(value)
  }
}

function isSensitiveKey(key: string, value: unknown): boolean {
  if (
    /^(?:input|output|cached|reasoning)Tokens$/.test(key) &&
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return false
  }
  return /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|credential|session|csrf|signature)/i.test(
    key,
  )
}

function isSecretString(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.constructor?.name === 'SecretString' &&
    String(value) === '[REDACTED]'
  )
}

function redactText(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/\b(token|password|secret|api[-_]?key|authorization)=([^\s&]+)/gi, '$1=[REDACTED]')
}
