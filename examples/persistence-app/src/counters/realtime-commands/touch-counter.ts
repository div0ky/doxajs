import { CurrentExecution, QueryBus, RealtimeCommand } from '@doxajs/core'
import { z } from 'zod'

import { CounterBroadcastedNow } from '../events/counter-broadcasted-now.js'
import { QueueCounterFromQuery } from '../queries/queue-counter-from-query.js'
import { CounterTouched } from '../signals/counter-touched.js'

const TouchCounterInput = z.object({ counterId: z.string().min(1), ownerId: z.string().min(1) })
type TouchCounterInput = z.infer<typeof TouchCounterInput>

export const realtimeCounterTouches: Array<{ actorId: string | undefined; counterId: string }> = []
export let realtimeCommandDisposedWhileHandling = false

export function resetRealtimeCounterTouches(): void {
  realtimeCounterTouches.length = 0
  realtimeCommandDisposedWhileHandling = false
}

export class TouchCounter extends RealtimeCommand<TouchCounterInput> {
  static override readonly id = 'counters.touch'
  static override readonly access = 'counters.realtime'
  static override readonly schema = TouchCounterInput
  static override readonly throttle = { limit: 2, windowMs: 2_000 }
  static override readonly timeoutMs = 50

  private readonly execution = this.inject(CurrentExecution)
  private readonly queries = this.inject(QueryBus)
  private handling = false

  async handle(input: TouchCounterInput): Promise<void> {
    if (input.counterId.startsWith('handler-secret:')) {
      throw new Error(`Handler exposed ${input.counterId}.`)
    }
    if (input.counterId === 'timeout') {
      this.handling = true
      try {
        await new Promise((resolve) => setTimeout(resolve, 200))
        await CounterTouched.dispatch({ counterId: 'late-timeout' })
      } finally {
        this.handling = false
      }
      return
    }
    if (input.counterId === 'nested-job') {
      await this.queries.execute(QueueCounterFromQuery, 'realtime-nested-job')
      return
    }
    realtimeCounterTouches.push({
      actorId: this.execution.context.actor.id,
      counterId: input.counterId,
    })
    await CounterBroadcastedNow.dispatch({ counterId: input.counterId })
  }

  dispose(): void {
    if (this.handling) realtimeCommandDisposedWhileHandling = true
  }
}
