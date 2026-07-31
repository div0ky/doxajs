import { Feature } from '@doxajs/core'

import { HttpPinged } from './events/http-pinged.js'
import { HealthRoute } from './http/health.route.js'
import { HelloRoute } from './http/hello.route.js'
import { HomeRoute } from './http/home.route.js'
import { PingRoute } from './http/ping.route.js'
import { RecordHttpPinged } from './listeners/record-http-pinged.js'
import { SystemEventRecorder } from './support/system-event-recorder.js'
import { DailyHealthCheckSchedule } from './schedules/daily-health-check.schedule.js'
import { DescribeDoxa } from './commands/describe-doxa.js'
import { PongRoute } from './http/pong.route.js'
import { BoobsRoute } from './http/boobs.route.js'
import { BoobJob } from './http/boob.job.js'
import { BoobPinged } from './http/boob.event.js'
import { BoobPingDoThingListener } from './http/log-boob-pinged.js'
import { AttachmentStatusRoute } from './http/attachment-status.route.js'
import { ReadAttachmentStatus } from './queries/read-attachment-status.js'

export class SystemFeature extends Feature {
  id = 'system'
  providers = [SystemEventRecorder]
  routes = [
    HomeRoute,
    HealthRoute,
    HelloRoute,
    PingRoute,
    PongRoute,
    BoobsRoute,
    AttachmentStatusRoute,
  ]
  queries = [ReadAttachmentStatus]
  events = [HttpPinged, BoobPinged]
  listeners = [RecordHttpPinged, BoobPingDoThingListener]
  schedules = [DailyHealthCheckSchedule]
  commands = [DescribeDoxa]
  jobs = [BoobJob]
}
