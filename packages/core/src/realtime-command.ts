import type { StandardSchema } from './http.js'
import { DoxaRole } from './role.js'

export interface RealtimeCommandThrottle {
  readonly limit: number
  readonly windowMs: number
}

export abstract class RealtimeCommand<Input = unknown> extends DoxaRole {
  static readonly id: string = ''
  static readonly access: string = ''
  static readonly schema: StandardSchema<unknown, unknown>
  static readonly throttle: RealtimeCommandThrottle
  static readonly timeoutMs: number = 2_000

  abstract handle(input: Input): void | Promise<void>
}

export type RealtimeCommandClass<Input = unknown> = abstract new (
  ...dependencies: never[]
) => RealtimeCommand<Input>

export interface RealtimeCommandError {
  readonly code: string
  readonly message: string
  readonly retryAfterMs?: number
}

export type RealtimeCommandResult =
  | { readonly id: string; readonly ok: true }
  | { readonly id: string; readonly ok: false; readonly error: RealtimeCommandError }
