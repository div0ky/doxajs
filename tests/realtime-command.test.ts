import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import { FakeBroadcastTransport } from '@doxajs/core'
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

  async function harness() {
    const queue = new FakeQueueManager()
    const broadcasts = new FakeBroadcastTransport()
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
    return { value, broadcasts }
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
})
