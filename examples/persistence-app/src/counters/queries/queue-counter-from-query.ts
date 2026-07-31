import { Query } from '@doxajs/core'

import { ProcessCounterJob } from '../jobs/process-counter.job.js'

export class QueueCounterFromQuery extends Query<string, void> {
  static readonly id = 'queue-counter-from-query'
  static override readonly access = 'public'

  async handle(key: string): Promise<void> {
    await ProcessCounterJob.dispatch({ key })
  }
}
