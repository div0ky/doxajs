import { Feature } from '@doxajs/core'

import { CaptureCounter } from './actions/capture-counter.js'
import { AssignCounterTag } from './actions/assign-counter-tag.js'
import { BroadcastCounter } from './actions/broadcast-counter.js'
import { CreateCounter } from './actions/create-counter.js'
import { CreateCounterNote } from './actions/create-counter-note.js'
import { CreateDomainCounter } from './actions/create-domain-counter.js'
import { DeleteCounter } from './actions/delete-counter.js'
import { DispatchProcessCounter } from './actions/dispatch-process-counter.js'
import { DispatchCounterSignal } from './actions/dispatch-counter-signal.js'
import { ExerciseCache } from './actions/exercise-cache.js'
import { ExerciseReadOnlyLegacyCustomer } from './actions/exercise-read-only-legacy-customer.js'
import { QueueNotifications } from './actions/queue-notifications.js'
import { InspectCounter } from './actions/inspect-counter.js'
import { IncrementMatchingCounters } from './actions/increment-matching-counters.js'
import { RefreshCounter } from './actions/refresh-counter.js'
import { RecordLegacyCustomerActivity } from './actions/record-legacy-customer-activity.js'
import { RenameCounter } from './actions/rename-counter.js'
import { RequestCounterNotification } from './actions/request-counter-notification.js'
import { SaveCounter } from './actions/save-counter.js'
import { SecureIncrementCounter } from './actions/secure-increment-counter.js'
import { SaveLegacyCustomer } from './actions/save-legacy-customer.js'
import { ClearLegacyCustomerNickname } from './actions/clear-legacy-customer-nickname.js'
import { DeleteLegacyCustomer } from './actions/delete-legacy-customer.js'
import { SaveLegacyNote } from './actions/save-legacy-note.js'
import { SaveDetachedCounter } from './actions/save-detached-counter.js'
import { MarkCounterCommand } from './commands/mark-counter.command.js'
import { CounterIncremented } from './events/counter-incremented.js'
import { CounterCreated } from './events/counter-created.js'
import { CounterNotificationRequested } from './events/counter-notification-requested.js'
import { CounterSaved } from './events/counter-saved.js'
import { CounterBroadcasted } from './events/counter-broadcasted.js'
import { CounterBroadcastedNow } from './events/counter-broadcasted-now.js'
import { DeleteCounterRoute } from './http/delete-counter.route.js'
import { IncrementCounterRoute } from './http/increment-counter.route.js'
import { SecureIncrementCounterRoute } from './http/secure-increment-counter.route.js'
import { ProcessCounterJob } from './jobs/process-counter.job.js'
import { RecordCounterNotification } from './listeners/record-counter-notification.js'
import { RecordCounterIncremented } from './listeners/record-counter-incremented.js'
import { RecordCounterCreated } from './listeners/record-counter-created.js'
import { RecordCounterIncrementedAfterCommit } from './listeners/record-counter-incremented-after-commit.js'
import { RecordCounterSaved } from './listeners/record-counter-saved.js'
import { Counter, CounterNote, CounterTag, CounterTagAssignment } from './models/counter.js'
import { LegacyCustomer } from './models/legacy-customer.js'
import { LegacyCustomerReadModel } from './models/legacy-customer-read-model.js'
import { LegacyNote } from './models/legacy-note.js'
import { CounterObserver } from './observers/counter.observer.js'
import { AttemptCounterWrite } from './queries/attempt-counter-write.js'
import { InspectCounterQueries } from './queries/inspect-counter-queries.js'
import { ProcessCountersSchedule } from './schedules/process-counters.schedule.js'
import { CounterTouched } from './signals/counter-touched.js'
import { RecordCounterTouched } from './signal-handlers/record-counter-touched.js'
import { CounterEventRecorder } from './support/counter-event-recorder.js'
import { CounterPolicy } from './policies/counter.policy.js'
import { TouchCounter } from './realtime-commands/touch-counter.js'

export class CountersFeature extends Feature {
  id = 'counters'
  providers = [CounterEventRecorder]
  models = [
    Counter,
    CounterNote,
    CounterTag,
    CounterTagAssignment,
    LegacyCustomer,
    LegacyCustomerReadModel,
    LegacyNote,
  ]
  observers = [CounterObserver]
  actions = [
    BroadcastCounter,
    AssignCounterTag,
    SaveCounter,
    CreateCounter,
    CreateCounterNote,
    CreateDomainCounter,
    InspectCounter,
    IncrementMatchingCounters,
    RefreshCounter,
    RecordLegacyCustomerActivity,
    DeleteCounter,
    SaveDetachedCounter,
    CaptureCounter,
    RenameCounter,
    DispatchProcessCounter,
    DispatchCounterSignal,
    ExerciseCache,
    ExerciseReadOnlyLegacyCustomer,
    QueueNotifications,
    RequestCounterNotification,
    SecureIncrementCounter,
    SaveLegacyCustomer,
    ClearLegacyCustomerNickname,
    DeleteLegacyCustomer,
    SaveLegacyNote,
  ]
  queries = [AttemptCounterWrite, InspectCounterQueries]
  commands = [MarkCounterCommand]
  realtimeCommands = [TouchCounter]
  routes = [IncrementCounterRoute, DeleteCounterRoute, SecureIncrementCounterRoute]
  events = [
    CounterIncremented,
    CounterCreated,
    CounterSaved,
    CounterNotificationRequested,
    CounterBroadcasted,
    CounterBroadcastedNow,
  ]
  listeners = [
    RecordCounterIncremented,
    RecordCounterCreated,
    RecordCounterIncrementedAfterCommit,
    RecordCounterSaved,
    RecordCounterNotification,
  ]
  jobs = [ProcessCounterJob]
  schedules = [ProcessCountersSchedule]
  policies = [CounterPolicy]
  signals = [CounterTouched]
  signalHandlers = [RecordCounterTouched]
}
