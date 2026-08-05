import { Query } from '@doxajs/core'

import { Counter } from '../models/counter.js'

export interface ConcurrentCounterReadsResult {
  readonly counts: readonly number[]
  readonly sameIdentity: boolean
}

export class ConcurrentCounterReads extends Query<void, ConcurrentCounterReadsResult> {
  static id = 'concurrent-counter-reads'
  static override readonly access = 'public'

  async handle(): Promise<ConcurrentCounterReadsResult> {
    const [counts, identities] = await Promise.all([
      Promise.all(Array.from({ length: 9 }, () => Counter.query().count())),
      Promise.all([Counter.find('concurrent-read'), Counter.find('concurrent-read')]),
    ])
    return { counts, sameIdentity: identities[0] === identities[1] }
  }
}
