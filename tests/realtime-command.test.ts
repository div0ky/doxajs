import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import {
  FakeBroadcastTransport,
  type RealtimeCommandThrottleDecision,
  type RealtimeCommandThrottleRequest,
} from '@doxajs/core'
import { Keryx } from '@doxajs/keryx'
import {
  DoxaTestHarness,
  FakeQueueManager,
  MemoryCache,
  MemoryTelemetry,
  MemoryTransactionManager,
} from '@doxajs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Application } from '../examples/persistence-app/dist/application.js'
import {
  realtimeCounterTouches,
  resetRealtimeCounterTouches,
} from '../examples/persistence-app/dist/counters/realtime-commands/touch-counter.js'

const workspace = path.resolve(import.meta.dirname, '..')
const applicationRoot = path.join(workspace, 'examples/persistence-app')
let artifacts: string

class SlowThrottleBroadcastTransport extends FakeBroadcastTransport {
  completed = false

  override async consumeRealtimeCommandThrottle(
    request: RealtimeCommandThrottleRequest,
  ): Promise<RealtimeCommandThrottleDecision> {
    await new Promise((resolve) => setTimeout(resolve, 250))
    this.completed = true
    return super.consumeRealtimeCommandThrottle(request)
  }
}

describe('Doxa realtime commands', () => {
  beforeAll(async () => {
    artifacts = await mkdtemp(path.join(tmpdir(), 'doxa-realtime-command-'))
    await compileApplication({
      tsconfigPath: path.join(applicationRoot, 'tsconfig.json'),
      applicationFile: path.join(applicationRoot, 'src/application.ts'),
      sourceRoot: path.join(applicationRoot, 'src'),
      outputRoot: path.join(applicationRoot, 'dist'),
      artifactsDirectory: artifacts,
    })
  })

  afterAll(async () => rm(artifacts, { recursive: true, force: true }))

  async function harness(broadcasts: FakeBroadcastTransport = new FakeBroadcastTransport()) {
    const queue = new FakeQueueManager()
    const value = await DoxaTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': new MemoryTransactionManager(queue),
        'provider:infrastructure/queues': queue,
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/telemetry': new MemoryTelemetry(),
        'provider:infrastructure/broadcasting': broadcasts,
      },
    })
    return { value, broadcasts, queue }
  }

  it('compiles and executes authenticated, validated, policy-protected ephemeral commands', async () => {
    const { value, broadcasts } = await harness()
    try {
      resetRealtimeCounterTouches()
      value.actingAsUser('ada')
      await expect(
        value.realtimeCommand('counters.touch', { counterId: 'counter-1', ownerId: 'ada' }, 'one'),
      ).resolves.toEqual({ id: 'one', ok: true })
      expect(realtimeCounterTouches).toEqual([{ actorId: 'ada', counterId: 'counter-1' }])
      expect(broadcasts.published).toEqual([
        expect.objectContaining({
          event: 'event:counters/counter-broadcasted-now',
          data: { id: 'counter-1' },
        }),
      ])

      await expect(
        value.realtimeCommand('counters.touch', { counterId: '', ownerId: 'ada' }, 'invalid'),
      ).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'command_invalid' }),
        }),
      )
      await expect(
        value.realtimeCommand(
          'counters.touch',
          { counterId: 'counter-2', ownerId: 'grace' },
          'denied',
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'command_forbidden' }),
        }),
      )
    } finally {
      await value.shutdown()
    }
  })

  it('rejects anonymous actors and applies actor-command rolling throttles', async () => {
    const { value } = await harness()
    try {
      await expect(
        value.realtimeCommand(
          'counters.touch',
          { counterId: 'counter-1', ownerId: 'ada' },
          'anonymous',
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'command_unauthenticated' }),
        }),
      )
      await expect(
        value.realtimeCommand('not.registered', {}, 'anonymous-unknown'),
      ).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'command_unauthenticated' }),
        }),
      )
      value.actingAsUser('ada')
      await value.realtimeCommand('counters.touch', { counterId: 'one', ownerId: 'ada' }, 'one')
      await value.realtimeCommand('counters.touch', { counterId: 'two', ownerId: 'ada' }, 'two')
      await expect(
        value.realtimeCommand('counters.touch', { counterId: 'three', ownerId: 'ada' }, 'three'),
      ).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({
            code: 'command_throttled',
            retryAfterMs: expect.any(Number),
          }),
        }),
      )
    } finally {
      await value.shutdown()
    }
  })

  it('returns a safe failure when the declared command deadline expires', async () => {
    const { value } = await harness()
    try {
      value.actingAsUser('ada')
      await expect(
        value.realtimeCommand(
          'counters.touch',
          { counterId: 'timeout', ownerId: 'ada' },
          'timeout',
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          error: {
            code: 'command_timeout',
            message: 'That command exceeded its execution deadline.',
          },
        }),
      )
    } finally {
      await value.shutdown()
    }
  })

  it('bounds validation, throttling, authorization, and handling with one deadline', async () => {
    const broadcasts = new SlowThrottleBroadcastTransport()
    const { value } = await harness(broadcasts)
    try {
      value.actingAsUser('ada')
      await expect(
        value.realtimeCommand(
          'counters.touch',
          { counterId: 'counter-1', ownerId: 'ada' },
          'slow-throttle',
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'command_timeout' }),
        }),
      )
      expect(broadcasts.completed).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 250))
    } finally {
      await value.shutdown()
    }
  })

  it('keeps durable dispatch forbidden through nested queries', async () => {
    const { value, queue } = await harness()
    try {
      value.actingAsUser('ada')
      await expect(
        value.realtimeCommand(
          'counters.touch',
          { counterId: 'nested-job', ownerId: 'ada' },
          'nested-job',
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'command_failed' }),
        }),
      )
      expect(queue.queued).toEqual([])
    } finally {
      await value.shutdown()
    }
  })

  it('keeps throttle buckets distinct for unambiguous actor-command tuples', async () => {
    const throttle = { limit: 1, windowMs: 2_000 }
    for (const broadcasts of [new FakeBroadcastTransport(), new Keryx()]) {
      await expect(
        broadcasts.consumeRealtimeCommandThrottle({
          actorId: 'a:b',
          command: 'c',
          requestId: 'first',
          throttle,
        }),
      ).resolves.toEqual({ allowed: true })
      await expect(
        broadcasts.consumeRealtimeCommandThrottle({
          actorId: 'a',
          command: 'b:c',
          requestId: 'second',
          throttle,
        }),
      ).resolves.toEqual({ allowed: true })
    }
  })
})
