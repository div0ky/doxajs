import { CurrentExecution, RealtimeCommand } from '@doxajs/core'
import { z } from 'zod'

import { CounterBroadcastedNow } from '../events/counter-broadcasted-now.js'

const TouchCounterInput = z.object({ counterId: z.string().min(1), ownerId: z.string().min(1) })
type TouchCounterInput = z.infer<typeof TouchCounterInput>

export const realtimeCounterTouches: Array<{ actorId: string | undefined; counterId: string }> = []

export function resetRealtimeCounterTouches(): void {
  realtimeCounterTouches.length = 0
}

export class TouchCounter extends RealtimeCommand<TouchCounterInput> {
  static override readonly id = 'counters.touch'
  static override readonly access = 'counters.realtime'
  static override readonly schema = TouchCounterInput
  static override readonly throttle = { limit: 2, windowMs: 2_000 }
  static override readonly timeoutMs = 50

  private readonly execution = this.inject(CurrentExecution)

  async handle(input: TouchCounterInput): Promise<void> {
    if (input.counterId === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return
    }
    realtimeCounterTouches.push({
      actorId: this.execution.context.actor.id,
      counterId: input.counterId,
    })
    await CounterBroadcastedNow.dispatch({ counterId: input.counterId })
  }
}
