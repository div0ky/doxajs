import { CurrentExecution, CurrentJob, Job } from '@doxajs/core'

import { recordedJobAttempts } from '../../support/job-attempts.js'
import { Counter } from '../models/counter.js'

export interface ProcessCounterInput {
  readonly key: string
  readonly failUntilAttempt?: number
  readonly holdMilliseconds?: number
  readonly counterId?: string
}

export class ProcessCounterJob extends Job<ProcessCounterInput> {
  static override readonly id = 'process-counter'
  static override readonly access = 'public'
  static override readonly retries = 2
  static override readonly retryDelay = 0
  static override readonly backoff = false
  static override readonly timeout = 10

  private readonly job = this.inject(CurrentJob)
  private readonly execution = this.inject(CurrentExecution)

  async handle(input: ProcessCounterInput): Promise<void> {
    recordedJobAttempts.push(
      Object.freeze({
        jobId: this.job.context.id,
        key: input.key,
        attempt: this.job.context.attempt,
        executionId: this.execution.context.executionId,
        correlationId: this.execution.context.correlationId,
        causationId: this.execution.context.causationId,
        actor: this.execution.context.actor.kind,
        actorId: this.execution.context.actor.id,
      }),
    )
    if (input.holdMilliseconds) {
      await new Promise((resolve) => setTimeout(resolve, input.holdMilliseconds))
    }
    if (this.job.context.attempt <= (input.failUntilAttempt ?? 0)) {
      throw new Error(`Counter job ${input.key} failed on attempt ${this.job.context.attempt}.`)
    }
    if (input.counterId) {
      const counter =
        (await Counter.find(input.counterId)) ?? Counter.make({ id: input.counterId, value: 0 })
      counter.increment(1)
      await counter.save()
    }
  }
}
