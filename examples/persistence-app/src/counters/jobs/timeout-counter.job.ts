import { Action, Job } from '@doxajs/core'

import { Counter } from '../models/counter.js'

export interface TimeoutCounterInput {
  readonly counterId: string
  readonly holdMilliseconds: number
  readonly detachWrite?: boolean
}

export class TimeoutCounterJob extends Job<TimeoutCounterInput> {
  static override readonly id = 'timeout-counter'
  static override readonly access = 'public'
  static override readonly retries = 0
  static override readonly retryDelay = 0
  static override readonly backoff = false
  static override readonly timeout = 1

  async handle(input: TimeoutCounterInput): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, input.holdMilliseconds))
    const counter = Counter.make({ id: input.counterId, value: 0 })
    counter.increment(1)
    const save = counter.save()
    if (input.detachWrite) {
      void save.catch(() => undefined)
      await new Promise<void>((resolve) => setImmediate(resolve))
    } else await save
  }
}

export class DispatchTimeoutCounter extends Action<TimeoutCounterInput, string> {
  static readonly id = 'dispatch-timeout-counter'
  static override readonly access = 'public'

  handle(input: TimeoutCounterInput): Promise<string> {
    return TimeoutCounterJob.dispatch(input)
  }
}
