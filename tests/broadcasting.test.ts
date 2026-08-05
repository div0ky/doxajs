import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import {
  Channel,
  FakeBroadcastTransport,
  Instant,
  PrivateChannel,
  type BroadcastGateway,
  type BroadcastMessage,
} from '@doxajs/core'
import { Keryx, KeryxPublishAuthenticator } from '@doxajs/keryx'
import {
  Realtime,
  type RealtimeConnectionState,
  type RealtimeError,
  type RealtimeSocket,
  type RealtimeSubscriptionState,
} from '@doxajs/realtime'
import {
  DoxaTestHarness,
  FakeQueueManager,
  MemoryCache,
  MemoryTelemetry,
  MemoryTransactionManager,
} from '@doxajs/testing'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { Application } from '../examples/persistence-app/dist/application.js'
import { BroadcastCounter } from '../examples/persistence-app/dist/counters/actions/broadcast-counter.js'
import { CounterBroadcasted } from '../examples/persistence-app/dist/counters/events/counter-broadcasted.js'
import { CounterBroadcastedNow } from '../examples/persistence-app/dist/counters/events/counter-broadcasted-now.js'
import {
  broadcastAuthorizationModelRead,
  resetBroadcastAuthorizationModelRead,
} from '../examples/persistence-app/dist/counters/policies/counter.policy.js'

const workspace = path.resolve(import.meta.dirname, '..')
const applicationRoot = path.join(workspace, 'examples/persistence-app')
let artifacts: string
let redis: StartedRedisContainer

function deadline(milliseconds: number): Instant {
  return Instant.fromEpochMicroseconds(BigInt(Date.now() + milliseconds) * 1_000n)
}

describe('Doxa broadcasting', () => {
  beforeAll(async () => {
    const [artifactsDirectory, redisContainer] = await Promise.all([
      mkdtemp(path.join(tmpdir(), 'doxa-broadcasting-')),
      new RedisContainer(process.env.DOXA_TEST_REDIS_IMAGE ?? 'redis:8-alpine').start(),
    ])
    artifacts = artifactsDirectory
    redis = redisContainer
    await compileApplication({
      tsconfigPath: path.join(applicationRoot, 'tsconfig.json'),
      applicationFile: path.join(applicationRoot, 'src/application.ts'),
      sourceRoot: path.join(applicationRoot, 'src'),
      outputRoot: path.join(applicationRoot, 'dist'),
      artifactsDirectory: artifacts,
    })
  })

  afterAll(async () => {
    await Promise.all([rm(artifacts, { recursive: true, force: true }), redis.stop()])
  })

  it('compiles queued and synchronous capabilities into manifest facts', async () => {
    const result = await compileApplication({
      tsconfigPath: path.join(applicationRoot, 'tsconfig.json'),
      applicationFile: path.join(applicationRoot, 'src/application.ts'),
      sourceRoot: path.join(applicationRoot, 'src'),
      outputRoot: path.join(applicationRoot, 'dist'),
      artifactsDirectory: artifacts,
    })
    expect(result.manifest.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'event:counters/counter-broadcasted',
          broadcast: 'queued',
        }),
        expect.objectContaining({
          id: 'event:counters/counter-broadcasted-now',
          broadcast: 'now',
        }),
      ]),
    )
    expect(
      result.manifest.providers.find((provider) => provider.capabilities.includes('broadcasting')),
    ).toEqual(expect.objectContaining({ id: 'provider:infrastructure/broadcasting' }))
  })

  it('fails compilation when broadcast subscription policy is absent', async () => {
    const root = await mkdtemp(path.join(workspace, '.broadcast-fixture-'))
    try {
      await mkdir(path.join(root, 'src'))
      await writeFile(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({
          extends: '../tsconfig.base.json',
          compilerOptions: {
            composite: false,
            rootDir: 'src',
            outDir: 'dist',
            declaration: false,
            declarationMap: false,
          },
          include: ['src/**/*.ts'],
        }),
      )
      await writeFile(
        path.join(root, 'src/application.ts'),
        `import { Channel, DoxaApplication, Event, FakeBroadcastTransport, Feature, type ShouldBroadcastNow } from '@doxajs/core'
class Broadcasts extends FakeBroadcastTransport { static readonly id = 'broadcasting' }
class Happened extends Event implements ShouldBroadcastNow {
  static override readonly id = 'happened'
  broadcastOn() { return new Channel('public.events') }
}
class AppFeature extends Feature { id = 'app'; providers = [Broadcasts]; events = [Happened] }
export class Application extends DoxaApplication { id = 'broadcast-fixture'; features = [AppFeature] }
`,
      )
      await expect(
        compileApplication({
          tsconfigPath: path.join(root, 'tsconfig.json'),
          applicationFile: path.join(root, 'src/application.ts'),
          sourceRoot: path.join(root, 'src'),
          outputRoot: path.join(root, 'dist'),
          artifactsDirectory: path.join(root, '.doxa'),
        }),
      ).rejects.toThrow('broadcast.subscribe ability')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('publishes now, queues durable broadcasts, and authorizes private subscriptions', async () => {
    const queue = new FakeQueueManager()
    const broadcasts = new FakeBroadcastTransport()
    const harness = await DoxaTestHarness.boot(Application, {
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
    try {
      resetBroadcastAuthorizationModelRead()
      harness.actingAsUser('ada')
      await harness.event(CounterBroadcastedNow, { counterId: 'counter-1' })
      expect(broadcasts.published).toEqual([
        expect.objectContaining({
          event: 'event:counters/counter-broadcasted-now',
          channels: [{ kind: 'public', name: 'counters.public' }],
          data: { id: 'counter-1' },
        }),
      ])

      await harness.event(CounterBroadcasted, { counterId: 'counter-1', value: 7 })
      expect(queue.queued).toEqual([
        expect.objectContaining({
          kind: 'broadcast',
          targetId: 'event:counters/counter-broadcasted',
          eventVersion: 1,
          payload: { counterId: 'counter-1', value: 7 },
        }),
      ])
      const queuedBroadcastId = queue.queued[0]!.id
      await queue.runNext()
      expect(broadcasts.published[1]?.id).toBe(queuedBroadcastId)
      expect(broadcasts.published[1]).toEqual(
        expect.objectContaining({
          event: 'counter.updated',
          data: { counterId: 'counter-1', value: 7 },
          channels: [
            { kind: 'private', name: 'counters.counter-1' },
            { kind: 'presence', name: 'counters.online' },
          ],
        }),
      )

      const beforeTransaction = queue.queued.length
      await harness.action(BroadcastCounter, { counterId: 'counter-2', value: 8 })
      expect(queue.queued).toHaveLength(beforeTransaction + 1)
      await expect(
        harness.action(BroadcastCounter, { counterId: 'counter-3', value: 9, fail: true }),
      ).rejects.toThrow('Broadcast transaction rolled back')
      expect(queue.queued).toHaveLength(beforeTransaction + 1)

      const admission = await broadcasts.connect('connection-1', new Request('http://doxa.test'))
      await expect(
        broadcasts.subscribe(admission, new PrivateChannel('counters.counter-1')),
      ).resolves.toEqual({})
      expect(broadcastAuthorizationModelRead).toBe(true)
      await expect(
        broadcasts.subscribe(admission, new PrivateChannel('secrets.counter-1')),
      ).rejects.toThrow('not authorized')
    } finally {
      await harness.shutdown()
    }
  })

  it('preserves the queued envelope ID across broadcast delivery retries', async () => {
    class RetryBroadcastTransport extends FakeBroadcastTransport {
      readonly attemptedIds: string[] = []

      override async publish(message: BroadcastMessage): Promise<void> {
        this.attemptedIds.push(message.id)
        if (this.attemptedIds.length === 1) throw new Error('temporary publish failure')
        await super.publish(message)
      }
    }

    const queue = new FakeQueueManager()
    const broadcasts = new RetryBroadcastTransport()
    const harness = await DoxaTestHarness.boot(Application, {
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
    try {
      await harness.event(CounterBroadcasted, { counterId: 'counter-1', value: 7 })
      const envelope = structuredClone(queue.queued[0]!)
      await expect(queue.runNext()).rejects.toThrow('temporary publish failure')
      queue.queued.push(envelope)
      await queue.runNext(2)

      expect(broadcasts.attemptedIds).toEqual([envelope.id, envelope.id])
      expect(broadcasts.published).toEqual([expect.objectContaining({ id: envelope.id })])
    } finally {
      await harness.shutdown()
    }
  })

  it('delivers through Keryx and the reconnecting subscriber protocol', async () => {
    let subscribed = false
    let connectionCount = 0
    const commands: unknown[] = []
    const gateway: BroadcastGateway = {
      connect: async (connectionId) => {
        const identityId = connectionCount++ === 0 ? 'ada' : 'grace'
        return {
          connectionId,
          actor: { kind: 'user', id: identityId },
          authentication: { state: 'authenticated', identityId },
          correlationId: 'connection-correlation',
        }
      },
      subscribe: async (admission, destination) => {
        subscribed = true
        return destination.kind === 'presence' ? { member: admission.actor } : {}
      },
      unsubscribe: async () => undefined,
      command: async (admission, request) => {
        commands.push({ actor: admission.actor, request })
        return { id: request.id, ok: true as const }
      },
    }
    const keryx = new Keryx({ port: 0, heartbeatMilliseconds: 50 })
    keryx.bind(gateway)
    const lifecycle = {
      signal: new AbortController().signal,
      deadline: deadline(2_000),
    }
    await keryx.start(lifecycle)
    const received: unknown[] = []
    const here: unknown[] = []
    const joining: unknown[] = []
    const leaving: unknown[] = []
    const realtime = new Realtime({
      url: `ws://${keryx.address.host}:${keryx.address.port}${keryx.address.path}`,
      reconnectMinimumMilliseconds: 10,
    })
    realtime
      .channel<{ 'counter.changed': { value: number } }>('counters.public')
      .listen('counter.changed', (data) => received.push(data))
    try {
      await waitFor(() => subscribed)
      await expect(realtime.command('counters.touch', { counterId: 'counter-1' })).resolves.toEqual(
        expect.objectContaining({ ok: true }),
      )
      expect(commands).toEqual([
        {
          actor: { kind: 'user', id: 'ada' },
          request: expect.objectContaining({
            command: 'counters.touch',
            payload: { counterId: 'counter-1' },
          }),
        },
      ])
      const message: BroadcastMessage = {
        id: 'message-1',
        event: 'counter.changed',
        channels: [new Channel('counters.public')],
        data: { value: 9 },
        occurredAt: new Date().toISOString(),
      }
      await keryx.publish(message)
      await waitFor(() => received.length === 1)
      expect(received).toEqual([{ value: 9 }])

      realtime
        .presence('counters.online')
        .here((members) => here.push(members))
        .joining((member) => joining.push(member))
        .leaving((member) => leaving.push(member))
      await waitFor(() => here.length === 1)
      const second = new Realtime({
        url: `ws://${keryx.address.host}:${keryx.address.port}${keryx.address.path}`,
      })
      const secondPresence = second
        .presence('counters.online')
        .here((members) => here.push(members))
      try {
        await waitFor(() => here.length === 2 && joining.length === 1)
        expect(here[1]).toEqual([
          { kind: 'user', id: 'ada' },
          { kind: 'user', id: 'grace' },
        ])
        expect(joining).toEqual([{ kind: 'user', id: 'grace' }])
        secondPresence.leave()
        await waitFor(() => leaving.length === 1)
        expect(leaving).toEqual([{ kind: 'user', id: 'grace' }])
      } finally {
        second.disconnect()
      }
    } finally {
      realtime.disconnect()
      await keryx.drain(lifecycle)
      await keryx.stop(lifecycle)
      keryx.dispose(lifecycle)
    }
  })

  it('buffers an early subscription until delayed authentication completes', async () => {
    let releaseAuthentication!: () => void
    const authentication = new Promise<void>((resolve) => {
      releaseAuthentication = resolve
    })
    let subscribed = false
    const gateway: BroadcastGateway = {
      connect: async (connectionId) => {
        await authentication
        return {
          connectionId,
          actor: { kind: 'user', id: 'ada' },
          authentication: { state: 'authenticated', identityId: 'ada' },
          correlationId: 'delayed-authentication',
        }
      },
      subscribe: async () => {
        subscribed = true
        return {}
      },
      unsubscribe: async () => undefined,
      command: async (_admission, request) => ({ id: request.id, ok: true as const }),
    }
    const keryx = new Keryx({ port: 0 })
    keryx.bind(gateway)
    const lifecycle = {
      signal: new AbortController().signal,
      deadline: deadline(2_000),
    }
    await keryx.start(lifecycle)
    const socket = new WebSocket(
      `ws://${keryx.address.host}:${keryx.address.port}${keryx.address.path}`,
    )
    const frames: Record<string, unknown>[] = []
    socket.on('message', (data) => frames.push(JSON.parse(data.toString())))
    try {
      await new Promise<void>((resolve) => socket.once('open', () => resolve()))
      socket.send(
        JSON.stringify({
          protocol: 3,
          type: 'subscribe',
          channel: { name: 'counters.public', kind: 'public' },
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(frames).toEqual([])
      releaseAuthentication()
      await waitFor(() => subscribed && frames.length === 2)
      expect(frames.map((frame) => frame.type)).toEqual(['connected', 'subscribed'])
    } finally {
      socket.close()
      await keryx.drain(lifecycle)
      await keryx.stop(lifecycle)
      keryx.dispose(lifecycle)
    }
  })

  it('authorizes a cross-origin browser socket with a single-use admission ticket', async () => {
    const secret = 'browser-admission-secret-with-at-least-thirty-two-characters'
    const origin = 'https://evergreen.example.test'
    let admitted: Awaited<ReturnType<BroadcastGateway['connect']>> | undefined
    let subscriptions = 0
    const gateway: BroadcastGateway = {
      connect: async () => {
        throw new Error('The cookie admission path must not handle a ticketed connection.')
      },
      subscribe: async (admission) => {
        admitted = admission
        subscriptions += 1
        return {}
      },
      unsubscribe: async () => undefined,
      command: async (_admission, request) => ({ id: request.id, ok: true as const }),
    }
    const keryx = new Keryx({
      applicationId: 'browser-admission',
      port: 0,
      secret,
    })
    keryx.bind(gateway)
    const lifecycle = {
      signal: new AbortController().signal,
      deadline: deadline(2_000),
    }
    await keryx.start(lifecycle)
    const grant = keryx.issueConnectionTicket({
      actor: { kind: 'user', id: 'ada' },
      authentication: {
        state: 'authenticated',
        identityId: 'ada',
        method: 'password',
        authenticatedAt: Instant.parse('2026-07-25T00:00:00.000000Z'),
        sessionId: 'session-1',
      },
      correlationId: 'http-correlation',
      origin,
    })
    const wrongOriginSocket = new WebSocket(
      `ws://${keryx.address.host}:${keryx.address.port}${keryx.address.path}`,
      ['doxa.realtime.v3', `doxa.ticket.${grant.ticket}`],
      { origin: 'https://hostile.example.test' },
    )
    const wrongOriginFrames: Record<string, unknown>[] = []
    wrongOriginSocket.on('message', (data) => wrongOriginFrames.push(JSON.parse(data.toString())))
    await new Promise<void>((resolve) => wrongOriginSocket.once('close', () => resolve()))
    expect(wrongOriginFrames).toEqual([
      expect.objectContaining({
        type: 'error',
        code: 'authentication_failed',
        fatal: true,
      }),
    ])

    let browserSocket: WebSocket | undefined
    let authorizationRequests = 0
    const realtime = new Realtime({
      url: `ws://${keryx.address.host}:${keryx.address.port}${keryx.address.path}`,
      authorizationEndpoint: '/canopy/broadcasting/authorize',
      authorizationFetch: async () => {
        authorizationRequests += 1
        return Response.json({
          ok: true,
          data: { ticket: grant.ticket, expiresAt: grant.expiresAt.toString() },
        })
      },
      socketFactory: (url, protocols) => {
        const socket = new WebSocket(
          url,
          typeof protocols === 'string' ? protocols : [...(protocols ?? [])],
          { origin },
        )
        browserSocket = socket
        return socket as unknown as RealtimeSocket
      },
    })
    const subscription = realtime.private('counters.ada')
    const secondSubscription = realtime.channel('counters.public')
    try {
      await waitFor(
        () => subscription.state === 'subscribed' && secondSubscription.state === 'subscribed',
      )
      expect(authorizationRequests).toBe(1)
      expect(browserSocket?.protocol).toBe('doxa.realtime.v3')
      expect(admitted).toEqual(
        expect.objectContaining({
          actor: { kind: 'user', id: 'ada' },
          authentication: expect.objectContaining({
            state: 'authenticated',
            identityId: 'ada',
            sessionId: 'session-1',
            authenticatedAt: Instant.parse('2026-07-25T00:00:00.000000Z'),
          }),
          correlationId: 'http-correlation',
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(subscriptions).toBe(2)

      const replay = new WebSocket(
        `ws://${keryx.address.host}:${keryx.address.port}${keryx.address.path}`,
        ['doxa.realtime.v3', `doxa.ticket.${grant.ticket}`],
        { origin },
      )
      const replayFrames: Record<string, unknown>[] = []
      replay.on('message', (data) => replayFrames.push(JSON.parse(data.toString())))
      await new Promise<void>((resolve) => replay.once('close', () => resolve()))
      expect(replayFrames).toEqual([
        expect.objectContaining({
          type: 'error',
          code: 'authentication_failed',
          fatal: true,
        }),
      ])
    } finally {
      realtime.disconnect()
      await keryx.drain(lifecycle)
      await keryx.stop(lifecycle)
      keryx.dispose(lifecycle)
    }
  })

  it('publishes from a worker through signed HTTP without starting a worker listener', async () => {
    const secret = 'keryx-test-secret-with-at-least-thirty-two-characters'
    let subscribed = false
    const gateway: BroadcastGateway = {
      connect: async (connectionId) => ({
        connectionId,
        actor: { kind: 'anonymous' },
        authentication: { state: 'anonymous' },
        correlationId: 'remote-publish',
      }),
      subscribe: async () => {
        subscribed = true
        return {}
      },
      unsubscribe: async () => undefined,
      command: async (_admission, request) => ({ id: request.id, ok: true as const }),
    }
    const web = new Keryx({ applicationId: 'remote-test', port: 0, secret })
    web.selectRoles({
      web: true,
      worker: false,
      scheduler: false,
      requiresRemotePublishing: false,
    })
    web.bind(gateway)
    const lifecycle = {
      signal: new AbortController().signal,
      deadline: deadline(2_000),
    }
    await web.start(lifecycle)
    const worker = new Keryx({
      applicationId: 'remote-test',
      publishUrl: `http://${web.address.host}:${web.address.port}`,
      secret,
    })
    worker.selectRoles({
      web: false,
      worker: true,
      scheduler: false,
      requiresRemotePublishing: true,
    })
    worker.bind(gateway)
    await worker.start(lifecycle)
    const received: unknown[] = []
    const realtime = new Realtime({
      url: `ws://${web.address.host}:${web.address.port}${web.address.path}`,
    })
    realtime
      .channel<{ 'counter.changed': { value: number } }>('counters.public')
      .listen('counter.changed', (data) => received.push(data))
    try {
      expect(worker.listenerActive).toBe(false)
      await waitFor(() => subscribed)
      await worker.publish({
        id: 'remote-message',
        event: 'counter.changed',
        channels: [new Channel('counters.public')],
        data: { value: 11 },
        occurredAt: new Date().toISOString(),
      })
      await waitFor(() => received.length === 1)
      await worker.publish({
        id: 'remote-message',
        event: 'counter.changed',
        channels: [new Channel('counters.public')],
        data: { value: 12 },
        occurredAt: new Date().toISOString(),
      })
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(received).toEqual([{ value: 11 }])
    } finally {
      realtime.disconnect()
      await worker.drain(lifecycle)
      await worker.stop(lifecycle)
      worker.dispose(lifecycle)
      await web.drain(lifecycle)
      await web.stop(lifecycle)
      web.dispose(lifecycle)
    }
  })

  it('fails a worker role closed when broadcasts cannot reach a web role', async () => {
    const keryx = new Keryx()
    keryx.selectRoles({
      web: false,
      worker: true,
      scheduler: false,
      requiresRemotePublishing: true,
    })
    keryx.bind({
      connect: async (connectionId) => ({
        connectionId,
        actor: { kind: 'anonymous' },
        authentication: { state: 'anonymous' },
        correlationId: 'worker-configuration',
      }),
      subscribe: async () => ({}),
      unsubscribe: async () => undefined,
      command: async (_admission, request) => ({ id: request.id, ok: true as const }),
    })
    const lifecycle = {
      signal: new AbortController().signal,
      deadline: deadline(2_000),
    }

    await expect(keryx.start(lifecycle)).rejects.toThrow(
      'DOXA_KERYX_PUBLISH_URL and DOXA_KERYX_SECRET',
    )
    expect(keryx.listenerActive).toBe(false)
  })

  it('rejects tampered and replayed worker publish requests', async () => {
    const secret = 'another-keryx-secret-with-at-least-thirty-two-characters'
    const gateway: BroadcastGateway = {
      connect: async (connectionId) => ({
        connectionId,
        actor: { kind: 'anonymous' },
        authentication: { state: 'anonymous' },
        correlationId: 'signed-publish',
      }),
      subscribe: async () => ({}),
      unsubscribe: async () => undefined,
      command: async (_admission, request) => ({ id: request.id, ok: true as const }),
    }
    const keryx = new Keryx({
      applicationId: 'signed-test',
      port: 0,
      secret,
      maxPublishPayloadBytes: 512,
    })
    keryx.bind(gateway)
    const lifecycle = {
      signal: new AbortController().signal,
      deadline: deadline(2_000),
    }
    await keryx.start(lifecycle)
    const path = keryx.address.publishPath
    const url = `http://${keryx.address.host}:${keryx.address.port}${path}`
    const body = JSON.stringify({
      protocol: 3,
      message: {
        id: 'signed-message',
        event: 'counter.changed',
        channels: [{ name: 'counters.public', kind: 'public' }],
        data: { value: 1 },
        occurredAt: new Date().toISOString(),
      },
    })
    const authenticator = new KeryxPublishAuthenticator({ key: 'default', secret })
    const headers = authenticator.headers('POST', path, body)
    try {
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body,
          })
        ).status,
      ).toBe(202)
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body,
          })
        ).status,
      ).toBe(409)
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authenticator.headers('POST', path, body),
            },
            body: body.replace('"value":1', '"value":2'),
          })
        ).status,
      ).toBe(401)
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...new KeryxPublishAuthenticator({ key: 'wrong', secret }).headers(
                'POST',
                path,
                body,
              ),
            },
            body,
          })
        ).status,
      ).toBe(401)
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...new KeryxPublishAuthenticator(
                { key: 'default', secret },
                60,
                () => Date.now() - 120_000,
              ).headers('POST', path, body),
            },
            body,
          })
        ).status,
      ).toBe(401)
      const oldProtocolBody = body.replace('"protocol":3', '"protocol":2')
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authenticator.headers('POST', path, oldProtocolBody),
            },
            body: oldProtocolBody,
          })
        ).status,
      ).toBe(422)
      const oversizedBody = body.replace('"value":1', `"value":"${'x'.repeat(1_000)}"`)
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authenticator.headers('POST', path, oversizedBody),
            },
            body: oversizedBody,
          })
        ).status,
      ).toBe(413)
    } finally {
      await keryx.drain(lifecycle)
      await keryx.stop(lifecycle)
      keryx.dispose(lifecycle)
    }
  })

  it('fans events and presence across Keryx replicas through Redis', async () => {
    const firstGateway = gatewayFor('ada')
    const secondGateway = gatewayFor('grace')
    const options = {
      applicationId: 'replicated-test',
      port: 0,
      secret: 'replicated-admission-secret-with-at-least-thirty-two-characters',
      topology: 'redis' as const,
      redisUrl: redis.getConnectionUrl(),
      heartbeatMilliseconds: 50,
      presenceLeaseMilliseconds: 150,
    }
    const first = new Keryx(options)
    const second = new Keryx(options)
    first.bind(firstGateway.gateway)
    second.bind(secondGateway.gateway)
    const lifecycle = {
      signal: new AbortController().signal,
      deadline: deadline(5_000),
    }
    await Promise.all([first.start(lifecycle), second.start(lifecycle)])
    const firstEvents: unknown[] = []
    const secondEvents: unknown[] = []
    const firstHere: unknown[] = []
    const secondHere: unknown[] = []
    const joined: unknown[] = []
    const left: unknown[] = []
    const firstRealtime = new Realtime({
      url: `ws://${first.address.host}:${first.address.port}${first.address.path}`,
    })
    const secondRealtime = new Realtime({
      url: `ws://${second.address.host}:${second.address.port}${second.address.path}`,
    })
    firstRealtime
      .channel<{ 'counter.changed': { value: number } }>('counters.public')
      .listen('counter.changed', (data) => firstEvents.push(data))
    secondRealtime
      .channel<{ 'counter.changed': { value: number } }>('counters.public')
      .listen('counter.changed', (data) => secondEvents.push(data))
    const firstPresence = firstRealtime
      .presence('counters.online')
      .here((members) => firstHere.push(members))
      .joining((member) => joined.push(member))
      .leaving((member) => left.push(member))
    let secondPresence: ReturnType<typeof secondRealtime.presence> | undefined
    try {
      await expect(
        first.consumeRealtimeCommandThrottle({
          actorId: 'shared-actor',
          command: 'counters.touch',
          requestId: 'redis-command-one',
          throttle: { limit: 1, windowMs: 5_000 },
        }),
      ).resolves.toEqual({ allowed: true })
      await expect(
        second.consumeRealtimeCommandThrottle({
          actorId: 'shared-actor',
          command: 'counters.touch',
          requestId: 'redis-command-two',
          throttle: { limit: 1, windowMs: 5_000 },
        }),
      ).resolves.toEqual({ allowed: false, retryAfterMs: expect.any(Number) })

      const ticket = first.issueConnectionTicket({
        actor: { kind: 'user', id: 'ticketed' },
        authentication: {
          state: 'authenticated',
          identityId: 'ticketed',
          sessionId: 'replicated-session',
        },
        correlationId: 'replicated-admission',
        origin: 'https://evergreen.example.test',
      })
      const ticketProtocols = ['doxa.realtime.v3', `doxa.ticket.${ticket.ticket}`]
      const ticketedSocket = new WebSocket(
        `ws://${second.address.host}:${second.address.port}${second.address.path}`,
        ticketProtocols,
        { origin: 'https://evergreen.example.test' },
      )
      const ticketedFrames: Record<string, unknown>[] = []
      ticketedSocket.on('message', (data) => ticketedFrames.push(JSON.parse(data.toString())))
      await waitFor(() => ticketedFrames.some((frame) => frame.type === 'connected'))
      ticketedSocket.close()

      const replayedSocket = new WebSocket(
        `ws://${first.address.host}:${first.address.port}${first.address.path}`,
        ticketProtocols,
        { origin: 'https://evergreen.example.test' },
      )
      const replayedFrames: Record<string, unknown>[] = []
      replayedSocket.on('message', (data) => replayedFrames.push(JSON.parse(data.toString())))
      await new Promise<void>((resolve) => replayedSocket.once('close', () => resolve()))
      expect(replayedFrames).toEqual([
        expect.objectContaining({
          type: 'error',
          code: 'authentication_failed',
          fatal: true,
        }),
      ])

      await waitFor(() => firstGateway.subscriptions >= 2 && firstHere.length === 1, 5_000)
      secondPresence = secondRealtime
        .presence('counters.online')
        .here((members) => secondHere.push(members))
      await waitFor(
        () =>
          firstGateway.subscriptions >= 2 &&
          secondGateway.subscriptions >= 2 &&
          firstHere.length === 1 &&
          secondHere.length === 1,
        5_000,
      )
      expect(firstHere[0]).toEqual([{ kind: 'user', id: 'ada' }])
      expect(secondHere[0]).toEqual(
        expect.arrayContaining([
          { kind: 'user', id: 'ada' },
          { kind: 'user', id: 'grace' },
        ]),
      )
      await waitFor(() => joined.length === 1)
      expect(joined).toEqual([{ kind: 'user', id: 'grace' }])

      await first.publish({
        id: 'replicated-message',
        event: 'counter.changed',
        channels: [new Channel('counters.public')],
        data: { value: 15 },
        occurredAt: new Date().toISOString(),
      })
      await waitFor(() => firstEvents.length === 1 && secondEvents.length === 1)
      expect(firstEvents).toEqual([{ value: 15 }])
      expect(secondEvents).toEqual([{ value: 15 }])
      await second.publish({
        id: 'replicated-message',
        event: 'counter.changed',
        channels: [new Channel('counters.public')],
        data: { value: 16 },
        occurredAt: new Date().toISOString(),
      })
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(firstEvents).toEqual([{ value: 15 }])
      expect(secondEvents).toEqual([{ value: 15 }])

      secondPresence.leave()
      await waitFor(() => left.length === 1)
      expect(left).toEqual([{ kind: 'user', id: 'grace' }])
      firstPresence.leave()
    } finally {
      firstRealtime.disconnect()
      secondRealtime.disconnect()
      await Promise.all([first.drain(lifecycle), second.drain(lifecycle)])
      await Promise.all([first.stop(lifecycle), second.stop(lifecycle)])
      first.dispose(lifecycle)
      second.dispose(lifecycle)
    }
  }, 15_000)

  it('loses readiness, disconnects sockets, and recovers when Redis connectivity returns', async () => {
    const state = gatewayFor('ada')
    const proxy = new RedisProxy(redis.getHost(), redis.getPort())
    await proxy.start()
    const keryx = new Keryx({
      applicationId: 'redis-recovery-test',
      port: 0,
      topology: 'redis',
      redisUrl: `redis://127.0.0.1:${proxy.port}`,
      heartbeatMilliseconds: 50,
    })
    keryx.bind(state.gateway)
    const lifecycle = {
      signal: new AbortController().signal,
      deadline: deadline(10_000),
    }
    await keryx.start(lifecycle)
    const connectionStates: RealtimeConnectionState[] = []
    const subscriptionStates: RealtimeSubscriptionState[] = []
    const realtime = new Realtime({
      url: `ws://${keryx.address.host}:${keryx.address.port}${keryx.address.path}`,
      reconnectMinimumMilliseconds: 10,
      reconnectMaximumMilliseconds: 50,
    })
    realtime.onConnectionState((value) => connectionStates.push(value))
    const subscription = realtime.channel('counters.public')
    subscription.onStateChange((value) => subscriptionStates.push(value))
    try {
      await waitFor(
        () => realtime.connectionState === 'authenticated' && subscription.state === 'subscribed',
        5_000,
      )
      await proxy.stop()
      await waitFor(
        () =>
          connectionStates.includes('disconnected') && connectionStates.includes('reconnecting'),
        5_000,
      )
      await proxy.start()
      await waitFor(
        () =>
          keryx.ready &&
          realtime.connectionState === 'authenticated' &&
          subscription.state === 'subscribed',
        10_000,
      )
      expect(subscriptionStates.filter((value) => value === 'subscribed').length).toBeGreaterThan(1)
    } finally {
      realtime.disconnect()
      await keryx.drain(lifecycle)
      await keryx.stop(lifecycle)
      keryx.dispose(lifecycle)
      await proxy.stop()
    }
  }, 20_000)

  it('resubscribes active channels after reconnect and stops after explicit disconnect', async () => {
    const sockets: TestSocket[] = []
    const connectionStates: RealtimeConnectionState[] = []
    const subscriptionStates: RealtimeSubscriptionState[] = []
    const realtime = new Realtime({
      url: 'ws://doxa.test/app',
      reconnectMinimumMilliseconds: 1,
      reconnectMaximumMilliseconds: 1,
      socketFactory: () => {
        const socket = new TestSocket()
        sockets.push(socket)
        return socket
      },
    })
    realtime.onConnectionState((state) => connectionStates.push(state))
    const subscription = realtime.private('counters.ada')
    subscription.onStateChange((state) => subscriptionStates.push(state))
    sockets[0]!.open()
    expect(sockets[0]!.sent).toEqual([])
    sockets[0]!.receive({ protocol: 3, type: 'connected', connectionId: 'connection-1' })
    expect(sockets[0]!.sent).toEqual([
      JSON.stringify({
        protocol: 3,
        type: 'subscribe',
        channel: { name: 'counters.ada', kind: 'private' },
      }),
    ])
    sockets[0]!.receive({
      protocol: 3,
      type: 'subscribed',
      channel: { name: 'counters.ada', kind: 'private' },
    })
    expect(subscription.state).toBe('subscribed')

    sockets[0]!.drop()
    await waitFor(() => sockets.length === 2)
    sockets[1]!.open()
    expect(sockets[1]!.sent).toEqual([])
    sockets[1]!.receive({ protocol: 3, type: 'connected', connectionId: 'connection-2' })
    expect(sockets[1]!.sent).toEqual(sockets[0]!.sent)

    realtime.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(sockets).toHaveLength(2)
    expect(connectionStates).toEqual(
      expect.arrayContaining(['transport-open', 'authenticated', 'disconnected', 'reconnecting']),
    )
    expect(subscriptionStates).toEqual(
      expect.arrayContaining(['subscribing', 'subscribed', 'pending']),
    )
  })

  it('makes subscription denials and acknowledgement timeouts observable', async () => {
    const sockets: TestSocket[] = []
    const errors: RealtimeError[] = []
    const realtime = new Realtime({
      url: 'ws://doxa.test/app',
      subscriptionTimeoutMilliseconds: 5,
      socketFactory: () => {
        const socket = new TestSocket()
        sockets.push(socket)
        return socket
      },
    })
    const denied = realtime.private('counters.denied')
    denied.onError((error) => errors.push(error))
    sockets[0]!.open()
    sockets[0]!.receive({ protocol: 3, type: 'connected', connectionId: 'connection-1' })
    sockets[0]!.receive({
      protocol: 3,
      type: 'error',
      code: 'subscription_denied',
      message: 'The subscription was not admitted.',
      retryable: false,
      fatal: false,
      operation: 'subscribe',
      channel: { name: 'counters.denied', kind: 'private' },
    })
    expect(denied.state).toBe('failed')
    expect(denied.lastError?.code).toBe('subscription_denied')

    const timedOut = realtime.private('counters.timeout')
    timedOut.onError((error) => errors.push(error))
    await waitFor(() => timedOut.state === 'failed')
    expect(timedOut.lastError?.code).toBe('subscribe_timeout')
    expect(errors.map((error) => error.code)).toEqual(['subscription_denied', 'subscribe_timeout'])
    realtime.disconnect()
  })

  it('surfaces terminal authentication failure without reconnecting', async () => {
    const sockets: TestSocket[] = []
    const errors: RealtimeError[] = []
    const realtime = new Realtime({
      url: 'ws://doxa.test/app',
      reconnectMinimumMilliseconds: 1,
      reconnectMaximumMilliseconds: 1,
      socketFactory: () => {
        const socket = new TestSocket()
        sockets.push(socket)
        return socket
      },
    })
    realtime.onError((error) => errors.push(error))
    realtime.channel('counters.public')
    sockets[0]!.open()
    sockets[0]!.receive({
      protocol: 3,
      type: 'error',
      code: 'authentication_failed',
      message: 'Connection admission failed.',
      retryable: false,
      fatal: true,
      operation: 'connect',
    })
    sockets[0]!.drop()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(sockets).toHaveLength(1)
    expect(realtime.connectionState).toBe('disconnected')
    expect(errors.at(0)).toEqual(
      expect.objectContaining({
        code: 'authentication_failed',
        retryable: false,
        fatal: true,
      }),
    )
  })

  it('makes admission endpoint failures observable before opening a socket', async () => {
    const sockets: TestSocket[] = []
    const errors: RealtimeError[] = []
    const realtime = new Realtime({
      url: 'wss://realtime.example.test/app',
      authorizationEndpoint: '/canopy/broadcasting/authorize',
      authorizationFetch: async () =>
        Response.json(
          { ok: false, code: 'authorization_denied', message: 'Authentication is required.' },
          { status: 401 },
        ),
      socketFactory: () => {
        const socket = new TestSocket()
        sockets.push(socket)
        return socket
      },
    })
    realtime.onError((error) => errors.push(error))
    realtime.channel('counters.public')
    await waitFor(() => realtime.connectionState === 'disconnected')

    expect(sockets).toEqual([])
    expect(errors).toEqual([
      expect.objectContaining({
        code: 'authorization_denied',
        retryable: false,
        fatal: true,
      }),
    ])
  })
})

async function waitFor(assertion: () => boolean, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!assertion()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for realtime state.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

class TestSocket implements RealtimeSocket {
  readyState = 0
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { readonly data: unknown }) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  readonly sent: string[] = []

  open(): void {
    this.readyState = 1
    this.onopen?.({})
  }

  drop(): void {
    this.readyState = 3
    this.onclose?.({ code: 1006, reason: 'Network connection lost' })
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
  }
}

function gatewayFor(identityId: string): {
  readonly gateway: BroadcastGateway
  readonly subscriptions: number
} {
  const state = {
    subscriptions: 0,
    gateway: {
      connect: async (connectionId: string) => ({
        connectionId,
        actor: { kind: 'user' as const, id: identityId },
        authentication: { state: 'authenticated' as const, identityId },
        correlationId: `replica-${identityId}`,
      }),
      subscribe: async (
        _admission: Awaited<ReturnType<BroadcastGateway['connect']>>,
        destination: { readonly kind: string },
      ) => {
        state.subscriptions += 1
        return destination.kind === 'presence'
          ? { member: { kind: 'user' as const, id: identityId } }
          : {}
      },
      unsubscribe: async () => undefined,
      command: async (_admission, request) => ({ id: request.id, ok: true as const }),
    } satisfies BroadcastGateway,
  }
  return Object.defineProperties(
    { gateway: state.gateway, subscriptions: 0 },
    {
      subscriptions: {
        enumerable: true,
        get: () => state.subscriptions,
      },
    },
  )
}

class RedisProxy {
  #server: Server | undefined
  #port = 0
  readonly #sockets = new Set<Socket>()

  constructor(
    private readonly targetHost: string,
    private readonly targetPort: number,
  ) {}

  get port(): number {
    return this.#port
  }

  async start(): Promise<void> {
    if (this.#server) return
    const server = createServer((downstream) => {
      const upstream = connect(this.targetPort, this.targetHost)
      this.#sockets.add(downstream)
      this.#sockets.add(upstream)
      downstream.pipe(upstream)
      upstream.pipe(downstream)
      const close = (): void => {
        downstream.destroy()
        upstream.destroy()
        this.#sockets.delete(downstream)
        this.#sockets.delete(upstream)
      }
      downstream.once('error', close)
      downstream.once('close', close)
      upstream.once('error', close)
      upstream.once('close', close)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.#port, '127.0.0.1', () => {
        server.off('error', reject)
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Redis test proxy did not bind a TCP port.'))
          return
        }
        this.#port = address.port
        resolve()
      })
    })
    this.#server = server
  }

  async stop(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy()
    this.#sockets.clear()
    const server = this.#server
    this.#server = undefined
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
