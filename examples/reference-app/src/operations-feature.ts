import { Feature } from '@doxajs/core'

import { DatabaseConnection } from './database-connection.js'
import { FailCounter } from './fail-counter.js'
import { IncrementCounter } from './increment-counter.js'
import { MutateCounterQuery } from './mutate-counter-query.js'
import { ObserveAi } from './observe-ai.js'
import { ReadCounter } from './read-counter.js'
import { ReferenceTransactionManager } from './reference-transaction-manager.js'
import { ReferenceObservationRecorder, ReferenceTelemetry } from './reference-observability.js'
import { Worker } from './worker.js'
import { WorkerConfig } from './worker-config.js'

export class OperationsFeature extends Feature {
  id = 'operations'
  configs = [WorkerConfig]
  providers = [
    DatabaseConnection,
    Worker,
    ReferenceTransactionManager,
    ReferenceObservationRecorder,
    ReferenceTelemetry,
  ]
  actions = [IncrementCounter, FailCounter, ObserveAi]
  queries = [ReadCounter, MutateCounterQuery]
}
