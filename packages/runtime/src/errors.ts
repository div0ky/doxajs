import type { Instant } from '@doxajs/core'

export class RuntimeIntegrityError extends Error {
  override readonly name = 'RuntimeIntegrityError'
}

export class LifecycleTimeoutError extends Error {
  override readonly name = 'LifecycleTimeoutError'

  constructor(
    readonly participantId: string,
    readonly phase: 'start' | 'drain' | 'stop' | 'dispose',
    readonly startedAt: Instant,
    readonly deadline: Instant,
    readonly elapsedMs: number,
  ) {
    super(`${participantId} exceeded its ${phase} deadline after ${elapsedMs}ms.`)
  }
}

export interface UnsettledLifecyclePhase {
  readonly participantId: string
  readonly phase: 'start' | 'stop' | 'dispose'
}

export class LifecycleCleanupTimeoutError extends Error {
  override readonly name = 'LifecycleCleanupTimeoutError'

  constructor(
    readonly deadline: Instant,
    readonly unsettled: readonly UnsettledLifecyclePhase[],
  ) {
    super(
      `Doxa startup cleanup exceeded its deadline with ${unsettled.length} unsettled lifecycle phase(s).`,
    )
  }
}

export class ConfigurationValidationError extends Error {
  override readonly name = 'ConfigurationValidationError'

  constructor(readonly issues: readonly string[]) {
    super(`Doxa configuration is invalid:\n${issues.map((issue) => `- ${issue}`).join('\n')}`)
  }
}

export class RuntimeBootError extends Error {
  override readonly name = 'RuntimeBootError'

  constructor(
    readonly primaryError: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Doxa failed to boot and completed startup unwind.', { cause: primaryError })
  }
}

export class RuntimeShutdownError extends Error {
  override readonly name = 'RuntimeShutdownError'

  constructor(readonly errors: readonly unknown[]) {
    super(`Doxa shutdown completed with ${errors.length} lifecycle failure(s).`)
  }
}

export class ExecutionAdmissionError extends Error {
  override readonly name = 'ExecutionAdmissionError'
}

export class OperationDispatchError extends Error {
  override readonly name = 'OperationDispatchError'
}

export class ExecutionFailureError extends Error {
  override readonly name = 'ExecutionFailureError'

  constructor(
    readonly primaryError: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Doxa execution failed and scoped cleanup also reported failures.', {
      cause: primaryError,
    })
  }
}

export class ExecutionCleanupError extends Error {
  override readonly name = 'ExecutionCleanupError'

  constructor(readonly cleanupErrors: readonly unknown[]) {
    super(`Doxa execution completed with ${cleanupErrors.length} scoped cleanup failure(s).`)
  }
}
