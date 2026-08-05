import { Query } from '@doxajs/core'

import { Counter } from '../models/counter.js'

export class ConcurrentCounterReads extends Query<void, readonly number[]> {
  static id = 'concurrent-counter-reads'
  static override readonly access = 'public'

  async handle(): Promise<readonly number[]> {
    return await Promise.all(Array.from({ length: 9 }, () => Counter.query().count()))
  }
}
