import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import {
  AuthorizationError,
  MemoryCache,
  Model,
  ModelIdentityMutationError,
  type ModelQuery,
  RoleInjectionError,
  SecretString,
  StaleModelError,
  UnknownModelAttributeError,
  sanitizeObservationAttributes,
  sanitizeObservationError,
  validateModelQueryPlan,
} from '@doxajs/core'
import {
  Doxa,
  ConfigurationValidationError,
  ExecutionAdmissionError,
  OperationDispatchError,
  ReadOnlyExecutionError,
  RuntimeBootError,
  RuntimeIntegrityError,
} from '@doxajs/runtime'
import { PostgresTheoria } from '@doxajs/theoria'
import { inspectArchitectureDiagnostics, inspectSurface } from '@doxajs/introspection'
import { DoxaOpenTelemetry } from '@doxajs/opentelemetry'
import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Application } from '../examples/reference-app/dist/application.js'
import { ContactDetails } from '../examples/reference-app/dist/contact-details.js'
import { FailCounter } from '../examples/reference-app/dist/fail-counter.js'
import { IncrementCounter } from '../examples/reference-app/dist/increment-counter.js'
import { lifecycleLog, resetLifecycleLog } from '../examples/reference-app/dist/lifecycle-log.js'
import { ObserveAi } from '../examples/reference-app/dist/observe-ai.js'
import { MutateCounterQuery } from '../examples/reference-app/dist/mutate-counter-query.js'
import { operationLog, resetOperationLog } from '../examples/reference-app/dist/operation-log.js'
import { ReadCounter } from '../examples/reference-app/dist/read-counter.js'
import {
  Application as RecursivePermissionApplication,
  RecursiveContactDetails,
} from '../examples/reference-app/dist/recursive-permission-application.js'
import {
  referenceObservations,
  referenceTelemetry,
  resetReferenceObservability,
} from '../examples/reference-app/dist/reference-observability.js'
import { prepareFrameworkSource } from '../packages/compiler/src/framework-source.js'
import { runWithModelSession } from '../packages/core/dist/model-session-context.js'
import { assertManifest } from '../packages/manifest/dist/index.js'

const workspace = path.resolve(import.meta.dirname, '..')
const referenceApplication = path.join(workspace, 'examples/reference-app')
const temporaryDirectories: string[] = []

class ModelRuntimeAttributeProof extends Model<{ id: string; name: string }> {}

describe('foundational compile-to-boot slice', () => {
  beforeEach(() => {
    resetLifecycleLog()
    resetOperationLog()
    resetReferenceObservability()
  })

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, {
          recursive: true,
          force: true,
        }),
      ),
    )
  })

  it('requires explicit reveal for secret configuration values', () => {
    const secret = SecretString.from('database-password')
    expect(String(secret)).toBe('[REDACTED]')
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}')
    expect(secret.reveal()).toBe('database-password')
  })

  it('rejects undeclared runtime attribute access on detached models', () => {
    const model = new ModelRuntimeAttributeProof({ id: 'proof', name: 'Declared' })
    expect(() =>
      (
        model as unknown as {
          getAttribute(key: string): unknown
        }
      ).getAttribute('password'),
    ).toThrow(UnknownModelAttributeError)
    expect(() =>
      (
        model as unknown as {
          fill(attributes: Record<string, unknown>): ModelRuntimeAttributeProof
        }
      ).fill({ vendorState: 'undeclared' }),
    ).toThrow(UnknownModelAttributeError)
  })

  it('compiles the public production Theoria profile and capture policy', () => {
    const prepared = prepareFrameworkSource(
      'app.config.ts',
      `export class Application {
        id = 'evergreen'
        features = []
        plugins = ['@doxajs/theoria']
        framework = { theoria: {
          profile: 'production-diagnostics', productionEnabled: true, sampleRate: 0.25,
          includeKinds: ['execution', 'action', 'ai.operation'],
          includePhases: ['started', 'completed', 'failed'],
          includeNames: ['model.score'], minimumDurationMilliseconds: 5,
          maximumPending: 5000, overflowPolicy: 'drop-oldest', batchSize: 200,
          flushIntervalMilliseconds: 50, hotRetentionDays: 3, warmRetentionDays: 30,
          maximumObservations: 5000000, poolMaximum: 4, serviceName: 'riley-worker',
          environment: 'production', release: '2026.07.16', instanceId: 'worker-7'
        } }
      }`,
    )
    expect(prepared.source).toContain('profile = "production-diagnostics"')
    expect(prepared.source).toContain('minimumDurationMilliseconds = 5')
    expect(prepared.source).toContain('includeKinds = ["execution","action","ai.operation"]')
    expect(prepared.source).toContain('application: "evergreen"')
    expect(prepared.source).toContain('serviceName = "riley-worker"')
    expect(prepared.source).toContain('release = "2026.07.16"')

    expect(() =>
      prepareFrameworkSource(
        'app.config.ts',
        `export class Application {
          id = 'invalid-theoria'
          features = []
          plugins = ['@doxajs/theoria']
          framework = { theoria: { maximumPending: 1.5 } }
        }`,
      ),
    ).toThrow('maximumPending must be a positive safe integer literal')

    expect(() =>
      prepareFrameworkSource(
        'app.config.ts',
        `export class Application {
          id = 'invalid-duration-filter'
          features = []
          plugins = ['@doxajs/theoria']
          framework = { theoria: {
            minimumDurationMilliseconds: 5,
            includePhases: ['started', 'completed']
          } }
        }`,
      ),
    ).toThrow('duration filtering requires started, completed, and failed phases')
  })

  it('generates optional Messaging Service configuration for explicit-sender Twilio SMS', () => {
    const prepared = prepareFrameworkSource(
      'app.config.ts',
      `export class Application {
        id = 'explicit-sender-sms'
        features = []
        plugins = ['@doxajs/twilio-sms']
      }`,
    )

    expect(prepared.source).toContain('declare messagingServiceSid?: string')
    expect(prepared.source).toContain(
      '...(config.messagingServiceSid ? { messagingServiceSid: config.messagingServiceSid } : {})',
    )
  })

  it('generates only authentication routes that login-only identities can support', () => {
    const prepared = prepareFrameworkSource(
      'app.config.ts',
      `export class Application {
        id = 'external-auth'
        features = []
        framework = { auth: { identity: {
          mode: 'login-only',
          verification: { mode: 'mapped' }
        } } }
      }`,
    )

    const featureRoutes = prepared.source
      .split('\n')
      .find((line) => line.trimStart().startsWith('routes = ['))
    expect(featureRoutes).toContain(
      'routes = [HealthRoute, LoginRoute, LogoutRoute, ReauthenticateRoute, MeRoute, TokenRoute',
    )
    expect(featureRoutes).not.toContain('RegisterRoute')
    expect(featureRoutes).not.toContain('ChangePasswordRoute')
    expect(featureRoutes).not.toContain('VerifyEmailRoute')
    expect(featureRoutes).not.toContain('RequestPasswordResetRoute')
    expect(featureRoutes).not.toContain('ResetPasswordRoute')
  })

  it('omits verification routes when a managed external identity leaves verification unmapped', () => {
    const prepared = prepareFrameworkSource(
      'app.config.ts',
      `export class Application {
        id = 'unverified-external-auth'
        features = []
        framework = { auth: { identity: {
          mode: 'managed',
          contactEmail: 'email'
        } } }
      }`,
    )

    const featureRoutes = prepared.source
      .split('\n')
      .find((line) => line.trimStart().startsWith('routes = ['))
    expect(featureRoutes).toContain('RegisterRoute')
    expect(featureRoutes).toContain('RequestPasswordResetRoute')
    expect(featureRoutes).not.toContain('VerifyEmailRoute')
    expect(featureRoutes).not.toContain('ResendVerificationRoute')
  })

  it('creates parented spans for executions and nested framework scopes', async () => {
    const runtime = await bootRuntime()
    const inboundTraceId = '1'.repeat(32)
    const inboundSpanId = '2'.repeat(16)

    await runtime.admit(
      {
        actor: { kind: 'system', id: 'trace-test' },
        transport: { kind: 'test', name: 'trace-proof' },
        trace: { traceId: inboundTraceId, spanId: inboundSpanId, traceFlags: 1 },
      },
      async (execution) => {
        expect(execution.trace.parentSpanId).toBe(inboundSpanId)
        await runtime.actions.execute(IncrementCounter, { amount: 1 })
      },
    )

    const spans = referenceTelemetry.filter((record) => record.kind === 'span')
    const executionSpan = spans.find((span) => span.name === 'trace-proof')
    const actionSpan = spans.find((span) => span.name.endsWith('/increment-counter'))
    const transactionSpan = spans.find((span) => span.name === 'action transaction')
    expect(executionSpan).toEqual(
      expect.objectContaining({
        traceId: inboundTraceId,
        parentSpanId: inboundSpanId,
        status: 'ok',
      }),
    )
    expect(actionSpan).toEqual(
      expect.objectContaining({
        traceId: inboundTraceId,
        parentSpanId: executionSpan?.spanId,
      }),
    )
    expect(transactionSpan).toEqual(
      expect.objectContaining({
        traceId: inboundTraceId,
        parentSpanId: actionSpan?.spanId,
      }),
    )
    expect(new Date(actionSpan!.endedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(actionSpan!.startedAt).getTime(),
    )

    const actionObservations = referenceObservations.filter((observation) =>
      observation.name.endsWith('/increment-counter'),
    )
    expect(actionObservations.map((observation) => observation.context.spanId)).toEqual([
      actionSpan?.spanId,
      actionSpan?.spanId,
    ])
    expect(actionObservations[0]?.context.parentSpanId).toBe(executionSpan?.spanId)
    await runtime.shutdown()
  })

  it('exports the same runtime span tree through OpenTelemetry', async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    expect(trace.setGlobalTracerProvider(provider)).toBe(true)
    const artifactsDirectory = await temporaryDirectory()
    await compile(artifactsDirectory)
    const runtime = await Doxa.boot(Application, {
      artifactsDirectory,
      dotenvPath: false,
      environment: {},
      providerOverrides: {
        'provider:operations/reference-telemetry': new DoxaOpenTelemetry({
          instrumentationName: 'doxa-test',
        }),
      },
    })
    const traceId = '3'.repeat(32)
    const parentSpanId = '4'.repeat(16)
    await runtime.admit(
      {
        actor: { kind: 'system', id: 'otel-root-test' },
        transport: { kind: 'test', name: 'otel-root-proof' },
      },
      () => undefined,
    )
    await runtime.admit(
      {
        actor: { kind: 'system', id: 'otel-test' },
        transport: { kind: 'test', name: 'otel-proof' },
        trace: { traceId, spanId: parentSpanId, isRemote: true, traceFlags: 1 },
      },
      () => runtime.actions.execute(IncrementCounter, { amount: 1 }),
    )
    await runtime.shutdown()
    await provider.forceFlush()

    const spans = exporter.getFinishedSpans()
    const root = spans.find((span) => span.name === 'otel-root-proof')
    const execution = spans.find((span) => span.name === 'otel-proof')
    const action = spans.find((span) => span.name.endsWith('/increment-counter'))
    const transaction = spans.find((span) => span.name === 'action transaction')
    expect(root?.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(root?.parentSpanContext).toBeUndefined()
    expect(execution?.spanContext().traceId).toBe(traceId)
    expect(execution?.parentSpanContext?.spanId).toBe(parentSpanId)
    expect(execution?.parentSpanContext?.isRemote).toBe(true)
    expect(action?.parentSpanContext?.spanId).toBe(execution?.spanContext().spanId)
    expect(transaction?.parentSpanContext?.spanId).toBe(action?.spanContext().spanId)
    expect(
      referenceObservations.find(
        (observation) =>
          observation.name.endsWith('/increment-counter') && observation.phase === 'completed',
      )?.context.spanId,
    ).toBe(action?.spanContext().spanId)
    await provider.shutdown()
  })

  it('records privacy-safe AI operations with token and outcome metadata', async () => {
    const runtime = await bootRuntime()
    await runtime.admit(
      { actor: { kind: 'system', id: 'ai-test' }, transport: { kind: 'test' } },
      () => runtime.actions.execute(ObserveAi, undefined),
    )

    const observations = referenceObservations.filter((entry) =>
      entry.name.startsWith('reference.classify'),
    )
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ai.operation', phase: 'started' }),
        expect.objectContaining({
          kind: 'ai.operation',
          phase: 'occurred',
          attributes: expect.objectContaining({
            inputTokens: 12,
            outputTokens: 3,
            outcome: 'qualified',
            reasonCode: 'reference-proof',
          }),
        }),
        expect.objectContaining({ kind: 'ai.operation', phase: 'completed' }),
      ]),
    )
    expect(new Set(observations.map((entry) => entry.context.spanId)).size).toBe(1)
    expect(JSON.stringify(observations)).not.toMatch(
      /prompt|completion|messageBody|sms|phone|customer/i,
    )
    expect(referenceTelemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'span', name: 'reference.classify', status: 'ok' }),
      ]),
    )
    await runtime.shutdown()
  })

  it('does not copy provider error content into AI observations', async () => {
    const runtime = await bootRuntime()
    await expect(
      runtime.admit(
        { actor: { kind: 'system', id: 'ai-error-test' }, transport: { kind: 'test' } },
        () =>
          runtime.ai.run({ kind: 'ai.operation', operationId: 'reference.failure' }, async () => {
            throw new Error('prompt=customer secret; phone=3125550199')
          }),
      ),
    ).rejects.toThrow('prompt=customer secret')

    const recorded = JSON.stringify(referenceObservations)
    expect(recorded).toContain('AI operation failed.')
    expect(recorded).not.toMatch(/customer secret|3125550199/)
    await runtime.shutdown()
  })

  it('fails closed for malformed model query plans before adapter execution', () => {
    expect(() =>
      validateModelQueryPlan({
        constraints: [
          {
            boolean: 'and',
            predicate: {
              kind: 'comparison',
              attribute: 'value',
              operator: 'execute sql' as '=',
              value: 1,
            },
          },
        ],
        orders: [],
        eagerLoads: [],
        relationshipConstraints: [],
      }),
    ).toThrow('Unsupported model query operator')
    expect(() =>
      validateModelQueryPlan(
        {
          constraints: [
            {
              boolean: 'and',
              predicate: {
                kind: 'comparison',
                attribute: 'unknown',
                operator: '=',
                value: 1,
              },
            },
          ],
          orders: [],
          eagerLoads: [],
          relationshipConstraints: [],
        },
        new Set(['id', 'value']),
      ),
    ).toThrow('Unknown model query attribute unknown')
    expect(() =>
      validateModelQueryPlan({
        constraints: [
          {
            boolean: 'xor' as 'and',
            predicate: { kind: 'comparison', attribute: 'value', operator: '=', value: 1 },
          },
        ],
        orders: [],
        eagerLoads: [],
        relationshipConstraints: [],
      }),
    ).toThrow('Unsupported model query boolean xor')
    expect(() =>
      validateModelQueryPlan({
        constraints: [
          {
            boolean: 'and',
            predicate: { kind: 'comparison', attribute: 'value', operator: '=', value: Infinity },
          },
        ],
        orders: [],
        eagerLoads: [],
        relationshipConstraints: [],
      }),
    ).toThrow('Model query numbers must be finite')
  })

  it('keeps model query plans immutable at runtime', () => {
    class QueryProofModel extends Model<{ id: string; value: number }> {
      static override readonly id = 'query-proof'
    }
    const query = QueryProofModel.where({ value: 1 }).orderBy('value')
    expect(Object.isFrozen(query.plan)).toBe(true)
    expect(Object.isFrozen(query.plan.constraints)).toBe(true)
    expect(Object.isFrozen(query.plan.constraints[0]?.predicate)).toBe(true)
    expect(Object.isFrozen(query.plan.orders)).toBe(true)
    class OtherQueryProofModel extends Model<{ id: string; value: number }> {
      static override readonly id = 'other-query-proof'
    }
    expect(() =>
      QueryProofModel.query().where(() => OtherQueryProofModel.query() as never),
    ).toThrow('Grouped model constraints must return the same model query')
  })

  it('clones public model writes and rejects identity mutation atomically', () => {
    class MutationProofModel extends Model<{
      id: string
      profile: { labels: string[] }
      nickname?: string
    }> {
      tryToReplaceIdentity(): void {
        ;(this.attributes as { id: string }).id = 'changed-in-model'
      }
    }
    const model = new MutationProofModel({
      id: 'mutation-proof',
      profile: { labels: ['original'] },
      nickname: 'before',
    })
    const profile = { labels: ['assigned'] }

    expect(model.setAttribute('profile', profile)).toBe(model)
    profile.labels.push('external')
    expect(model.getAttribute('profile')).toEqual({ labels: ['assigned'] })
    const readProfile = model.getAttribute('profile')
    readProfile.labels.push('read-mutation')
    expect(model.getAttribute('profile')).toEqual({ labels: ['assigned'] })
    const patch = { profile: { labels: ['filled'] } }
    expect(model.fill(patch)).toBe(model)
    patch.profile.labels.push('external-fill')
    expect(model.getAttribute('profile')).toEqual({ labels: ['filled'] })
    expect(model.fill({ nickname: undefined })).toBe(model)
    expect(model.getAttribute('nickname')).toBeUndefined()

    expect(() => model.setAttribute('id' as never, 'changed' as never)).toThrow(
      ModelIdentityMutationError,
    )
    expect(() =>
      model.fill({ profile: { labels: ['not-applied'] }, id: 'changed' } as never),
    ).toThrow(ModelIdentityMutationError)
    expect(model.id).toBe('mutation-proof')
    expect(model.getAttribute('profile')).toEqual({ labels: ['filled'] })
    expect(() => model.tryToReplaceIdentity()).toThrow(TypeError)
    expect(model.id).toBe('mutation-proof')
  })

  it('rejects model queries and cursors after their execution session ends', async () => {
    class QueryProofModel extends Model<{ id: string; value: number }> {
      static override readonly id = 'query-proof'
    }
    const firstSession = modelQuerySession()
    const secondSession = modelQuerySession()
    let query!: ModelQuery<QueryProofModel, { id: string; value: number }>
    let cursor!: AsyncIterable<QueryProofModel>
    await runWithModelSession(firstSession, () => {
      query = QueryProofModel.query()
      cursor = query.cursor()
      expect(() => QueryProofModel.query().cursor({ batchSize: 1_001 })).toThrow(
        'Cursor batch size must be at most 1000',
      )
    })
    firstSession.active = false

    await runWithModelSession(secondSession, async () => {
      expect(() => query.get()).toThrow(StaleModelError)
      await expect(collect(cursor)).rejects.toBeInstanceOf(StaleModelError)
    })
  })

  it('recursively redacts observation evidence before a recorder can receive it', () => {
    const attributes = sanitizeObservationAttributes({
      email: 'ada@example.com',
      password: 'correct horse battery staple',
      headers: { authorization: 'Bearer dangerously-visible', accept: 'application/json' },
      database: 'postgresql://doxa:private@localhost/doxa',
      circular: (() => {
        const value: Record<string, unknown> = {}
        value.self = value
        return value
      })(),
    })
    expect(attributes).toEqual(
      expect.objectContaining({
        email: 'ada@example.com',
        password: '[REDACTED]',
        headers: { authorization: '[REDACTED]', accept: 'application/json' },
        database: 'postgresql://doxa:[REDACTED]@localhost/doxa',
        circular: { self: '[CIRCULAR]' },
      }),
    )
    expect(sanitizeObservationError(new Error('token=visible-secret')).message).toBe(
      'token=[REDACTED]',
    )
  })

  it('requires explicit production diagnostics enablement before Theoria can start', async () => {
    const recorder = new PostgresTheoria({
      connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused',
      environment: 'production',
    })
    await expect(
      recorder.start({
        signal: new AbortController().signal,
        deadline: new Date(Date.now() + 1_000),
      }),
    ).rejects.toThrow('production diagnostics require')
  })

  it('does not let recorder resource metadata bypass the production guard', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const recorder = new PostgresTheoria({
        connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused',
        environment: 'development',
      })
      await expect(
        recorder.start({
          signal: new AbortController().signal,
          deadline: new Date(Date.now() + 1_000),
        }),
      ).rejects.toThrow('production diagnostics require')
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })

  it('fails clearly when a role with required scoped dependencies is constructed directly', () => {
    expect(() => new IncrementCounter()).toThrow(RoleInjectionError)
  })

  it('provides a deterministic in-memory cache with TTL and atomic-style primitives', async () => {
    let now = 1_000
    const cache = new MemoryCache(() => now)
    expect(await cache.add('counter', 1, { ttlSeconds: 2 })).toBe(true)
    expect(await cache.add('counter', 99)).toBe(false)
    expect(await cache.increment('counter', 2)).toBe(3)
    expect(await cache.remember('label', () => 'first')).toBe('first')
    expect(await cache.remember('label', () => 'second')).toBe('first')
    now = 3_001
    expect(await cache.get('counter')).toBeUndefined()
    expect(await cache.add('counter', 4)).toBe(true)
  })

  it('emits deterministic semantic and constructor-only artifacts', async () => {
    const root = await temporaryDirectory()
    const first = await compile(path.join(root, 'first'))
    const second = await compile(path.join(root, 'second'))
    const firstManifest = await readFile(first.manifestPath, 'utf8')
    const secondManifest = await readFile(second.manifestPath, 'utf8')
    const firstRegistry = await readFile(first.registryPath, 'utf8')
    const secondRegistry = await readFile(second.registryPath, 'utf8')

    expect(firstManifest).toBe(secondManifest)
    expect(firstRegistry).toBe(secondRegistry)
    expect(first.manifest.applicationId).toBe('reference-app')
    expect(first.manifest.permissionSource).toEqual(
      expect.objectContaining({
        id: 'permission-source:authorization/application',
        ownerId: 'authorization',
        scope: 'execution',
        abilities: ['contact.read', 'contact.update'],
        dependencies: expect.arrayContaining([
          expect.objectContaining({
            kind: 'role',
            parameter: 'access',
            targetId: 'service:shared-state/application-access',
          }),
        ]),
      }),
    )
    expect(inspectSurface(first.manifest, 'permissionSources')).toEqual({
      items: [expect.objectContaining({ id: 'permission-source:authorization/application' })],
      total: 1,
      truncated: false,
    })
    expect(first.manifest.features.map((feature) => feature.id)).toEqual([
      'authorization',
      'operations',
      'shared-state',
    ])
    expect(
      first.manifest.configurations
        .flatMap((configuration) => configuration.properties)
        .map((property) => property.environmentKey),
    ).toEqual(['APP_ENVIRONMENT', 'APP_PORT', 'WORKER_CONCURRENCY', 'WORKER_FAIL_STARTUP'])
    expect(first.manifest.providers.map((provider) => [provider.id, provider.scope])).toEqual([
      ['provider:operations/database-connection', 'singleton'],
      ['provider:operations/reference-observations', 'singleton'],
      ['provider:operations/reference-telemetry', 'singleton'],
      ['provider:operations/transactions', 'singleton'],
      ['provider:operations/worker', 'singleton'],
      ['service:operations/task-runner', 'transient'],
      ['service:shared-state/application-access', 'execution'],
      ['service:shared-state/execution-counter', 'execution'],
    ])
    expect(first.manifest.actions.map((action) => [action.id, action.transactional])).toEqual([
      ['action:operations/fail-counter', true],
      ['action:operations/increment-counter', true],
      ['action:operations/observe-ai', true],
    ])
    expect(first.manifest.queries.map((query) => [query.id, query.transactional])).toEqual([
      ['query:authorization/contact-details', false],
      ['query:operations/mutate-counter', false],
      ['query:operations/read-counter', false],
    ])
    expect(
      first.manifest.actions.find((action) => action.id.endsWith('/increment-counter'))
        ?.dependencies,
    ).toEqual([
      expect.objectContaining({
        kind: 'role',
        parameter: 'counter',
        targetId: 'service:shared-state/execution-counter',
      }),
      expect.objectContaining({
        kind: 'role',
        parameter: 'audit',
        token: 'OptionalCounterAudit',
        optional: true,
      }),
    ])
    expect(
      first.manifest.providers.find((provider) => provider.id.endsWith('/execution-counter'))
        ?.dependencies,
    ).toEqual([
      expect.objectContaining({
        kind: 'constructor',
        parameter: 'execution',
        targetId: 'doxa:current-execution',
      }),
    ])
    expect(
      first.manifest.providers.find((provider) => provider.id.endsWith('/execution-counter'))
        ?.lifecycle,
    ).toEqual({ start: false, drain: false, stop: false, dispose: true })
    expect(firstRegistry).not.toContain('dependencies')
    expect(firstRegistry).not.toContain('lifecycle')
  })

  it('exports an execution-scoped ordinary service across Feature boundaries', async () => {
    const result = await compileFixture(`
      import {
        DoxaApplication, Feature, Query, type ExecutionScoped,
      } from '@doxajs/core'

      class SharedAccess implements ExecutionScoped {}
      class SharedFormatter {}
      class ReadAccess extends Query<void, SharedAccess> {
        static readonly id = 'read-access'
        static override readonly access = 'public'
        private readonly access = this.inject(SharedAccess)
        private readonly formatter = this.inject(SharedFormatter)
        handle() { void this.formatter; return this.access }
      }
      class AccessFeature extends Feature {
        id = 'access'
        provides = [SharedAccess, SharedFormatter]
      }
      class ConsumerFeature extends Feature {
        id = 'consumer'
        queries = [ReadAccess]
      }
      export class Application extends DoxaApplication {
        id = 'shared-service'
        features = [AccessFeature, ConsumerFeature]
      }
    `)

    expect(result.manifest.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'service:access/shared-access',
          ownerId: 'access',
          role: 'service',
          scope: 'execution',
        }),
        expect.objectContaining({
          id: 'service:access/shared-formatter',
          ownerId: 'access',
          role: 'service',
          scope: 'transient',
        }),
      ]),
    )
  })

  it('compiles strict mapped-model projections and independent management modes', async () => {
    const result = await compileFixture(`
      import { DoxaApplication, Feature, Model } from '@doxajs/core'

      interface ContactAttributes {
        id: string
        displayName: string
        nickname?: string | null
        active: boolean
      }
      class ManagedContact extends Model<ContactAttributes> {
        static readonly id = 'managed-contact'
        static readonly table = 'managed_contacts'
        static readonly columns = { displayName: 'display_name' }
      }
      class ReadOnlyManagedContact extends Model<ContactAttributes> {
        static readonly id = 'read-only-managed-contact'
        static readonly table = 'read_only_managed_contacts'
        static readonly readOnly = true
      }
      class ExternalContact extends Model<ContactAttributes> {
        static readonly id = 'external-contact'
        static readonly table = 'external_contacts'
        static readonly managed = false
      }
      class ReadOnlyExternalContact extends Model<ContactAttributes> {
        static readonly id = 'read-only-external-contact'
        static readonly table = 'read_only_external_contacts'
        static readonly managed = false
        static readonly readOnly = true
      }
      class ContactFeature extends Feature {
        id = 'contacts'
        models = [
          ManagedContact,
          ReadOnlyManagedContact,
          ExternalContact,
          ReadOnlyExternalContact,
        ]
      }
      export class Application extends DoxaApplication {
        id = 'mapped-model-contract'
        features = [ContactFeature]
      }
    `)

    const byName = Object.fromEntries(result.manifest.models.map((model) => [model.name, model]))
    expect(byName.ManagedContact).toMatchObject({
      attributes: ['active', 'displayName', 'id', 'nickname'],
      attributeTypes: {
        active: { kind: 'boolean', nullable: false, optional: false },
        displayName: { kind: 'string', nullable: false, optional: false },
        id: { kind: 'string', nullable: false, optional: false },
        nickname: { kind: 'string', nullable: true, optional: true },
      },
      storage: {
        kind: 'table',
        columns: {
          active: 'active',
          displayName: 'display_name',
          id: 'id',
          nickname: 'nickname',
        },
        managed: true,
        readOnly: false,
        versionSource: { kind: 'xmin' },
      },
    })
    expect(byName.ReadOnlyManagedContact?.storage).toMatchObject({
      managed: true,
      readOnly: true,
      versionSource: { kind: 'none' },
    })
    expect(byName.ExternalContact?.storage).toMatchObject({
      managed: false,
      readOnly: false,
      versionSource: { kind: 'xmin' },
    })
    expect(byName.ReadOnlyExternalContact?.storage).toMatchObject({
      managed: false,
      readOnly: true,
      versionSource: { kind: 'none' },
    })
  })

  it('requires literal mapped-model management settings', async () => {
    await expect(
      compileFixture(`
        import { DoxaApplication, Feature, Model } from '@doxajs/core'
        const managed = false
        interface ContactAttributes { id: string }
        class Contact extends Model<ContactAttributes> {
          static readonly id = 'contact'
          static readonly table = 'contacts'
          static readonly managed = managed
        }
        class ContactFeature extends Feature { id = 'contacts'; models = [Contact] }
        export class Application extends DoxaApplication {
          id = 'invalid-mapped-model-contract'
          features = [ContactFeature]
        }
      `),
    ).rejects.toThrow('Contact.managed must be a boolean literal')
  })

  it('keeps unprovided concrete services private to their Feature', async () => {
    await expect(
      compileFixture(`
        import { DoxaApplication, Feature, Query } from '@doxajs/core'

        class PrivateAccess {}
        class FirstRead extends Query<void, void> {
          static readonly id = 'first-read'
          static override readonly access = 'public'
          private readonly access = this.inject(PrivateAccess)
          handle() { void this.access }
        }
        class SecondRead extends Query<void, void> {
          static readonly id = 'second-read'
          static override readonly access = 'public'
          private readonly access = this.inject(PrivateAccess)
          handle() { void this.access }
        }
        class FirstFeature extends Feature { id = 'first'; queries = [FirstRead] }
        class SecondFeature extends Feature { id = 'second'; queries = [SecondRead] }
        export class Application extends DoxaApplication {
          id = 'private-service'
          features = [FirstFeature, SecondFeature]
        }
      `),
    ).rejects.toThrow('reachable across Feature boundaries without being provided explicitly')
  })

  it('rejects framework roles exported as ordinary services', async () => {
    await expect(
      compileFixture(`
        import { DoxaApplication, Feature, Query } from '@doxajs/core'

        class ReadAccess extends Query<void, void> {
          static readonly id = 'read-access'
          static override readonly access = 'public'
          handle() {}
        }
        class AccessFeature extends Feature {
          id = 'access'
          provides = [ReadAccess]
          queries = [ReadAccess]
        }
        export class Application extends DoxaApplication {
          id = 'invalid-provides'
          features = [AccessFeature]
        }
      `),
    ).rejects.toThrow(
      '[DOXA-COMPILER-ROLE-001] ReadAccess is framework-facing and cannot be exported as an ordinary service through provides',
    )
  })

  it('rejects ambiguous and provider-promoted provides declarations', async () => {
    await expect(
      compileFixture(`
        import { DoxaApplication, Feature } from '@doxajs/core'

        class SharedAccess {}
        class FirstFeature extends Feature { id = 'first'; provides = [SharedAccess] }
        class SecondFeature extends Feature { id = 'second'; provides = [SharedAccess] }
        export class Application extends DoxaApplication {
          id = 'ambiguous-provides'
          features = [FirstFeature, SecondFeature]
        }
      `),
    ).rejects.toThrow('SharedAccess is already provided by Feature first')

    await expect(
      compileFixture(`
        import { DoxaApplication, Feature } from '@doxajs/core'

        class SharedAccess { static readonly id = 'shared-access' }
        class AccessFeature extends Feature {
          id = 'access'
          providers = [SharedAccess]
          provides = [SharedAccess]
        }
        export class Application extends DoxaApplication {
          id = 'promoted-provides'
          features = [AccessFeature]
        }
      `),
    ).rejects.toThrow(
      '[DOXA-COMPILER-ROLE-002] SharedAccess cannot be both an infrastructure provider and an exported ordinary service',
    )
  })

  it('requires Keryx when an application declares realtime commands', async () => {
    await expect(
      compileFixture(`
        import { allow, DoxaApplication, Feature, Policy, RealtimeCommand } from '@doxajs/core'

        class TouchCursor extends RealtimeCommand<Record<string, never>> {
          static override readonly id = 'collaboration.touch-cursor'
          static override readonly access = 'collaboration.command'
          static override readonly schema = {
            '~standard': {
              version: 1 as const,
              vendor: 'test',
              validate: (value: unknown) => ({ value: value as Record<string, never> }),
            },
          }
          static override readonly throttle = { limit: 4, windowMs: 2000 }
          handle(_input: Record<string, never>): void {}
        }
        class CollaborationPolicy extends Policy {
          static override readonly id = 'collaboration'
          static override readonly abilities = ['collaboration.command']
          decide(_request: unknown) { return allow('collaboration') }
        }
        class CollaborationFeature extends Feature {
          id = 'collaboration'
          policies = [CollaborationPolicy]
          realtimeCommands = [TouchCursor]
        }
        export class Application extends DoxaApplication {
          id = 'realtime-command-without-keryx'
          features = [CollaborationFeature]
        }
      `),
    ).rejects.toThrow(
      'Applications with realtime commands require exactly one broadcasting provider; found 0. Enable Keryx with doxa add keryx.',
    )
  })

  it('rejects direct and transitive ActionBus reachability from operation boundaries', async () => {
    await expect(
      compileFixture(`
        import { Action, ActionBus, DoxaApplication, Feature } from '@doxajs/core'

        class InvalidAction extends Action<void, void> {
          static readonly id = 'invalid'
          static override readonly access = 'public'
          private readonly actions = this.inject(ActionBus)
          async handle(): Promise<void> { await this.actions.execute(InvalidAction, undefined) }
        }
        class AppFeature extends Feature { id = 'app'; actions = [InvalidAction] }
        export class Application extends DoxaApplication {
          id = 'nested-action-direct'
          features = [AppFeature]
        }
      `),
    ).rejects.toThrow(
      '[DOXA-COMPILER-ARCH-001] action:app/invalid reaches ActionBus through action:app/invalid -> doxa:action-bus',
    )

    await expect(
      compileFixture(`
        import { Action, ActionBus, allow, DoxaApplication, Feature, Policy, RealtimeCommand } from '@doxajs/core'

        class DurableAction extends Action<void, void> {
          static readonly id = 'durable'
          static override readonly access = 'public'
          handle(): void {}
        }
        class InvalidCommand extends RealtimeCommand<Record<string, never>> {
          static override readonly id = 'app.invalid'
          static override readonly access = 'app.command'
          static override readonly schema = {
            '~standard': {
              version: 1 as const,
              vendor: 'test',
              validate: (value: unknown) => ({ value: value as Record<string, never> }),
            },
          }
          static override readonly throttle = { limit: 1, windowMs: 1000 }
          private readonly actions = this.inject(ActionBus)
          async handle(_input: Record<string, never>): Promise<void> {
            await this.actions.execute(DurableAction, undefined)
          }
        }
        class AppPolicy extends Policy {
          static override readonly id = 'app'
          static override readonly abilities = ['app.command']
          decide(_request: unknown) { return allow('app') }
        }
        class AppFeature extends Feature {
          id = 'app'
          actions = [DurableAction]
          policies = [AppPolicy]
          realtimeCommands = [InvalidCommand]
        }
        export class Application extends DoxaApplication {
          id = 'realtime-command-action'
          features = [AppFeature]
        }
      `),
    ).rejects.toThrow(
      '[DOXA-COMPILER-ARCH-001] realtime-command:app/app.invalid reaches ActionBus through realtime-command:app/app.invalid -> doxa:action-bus',
    )

    await expect(
      compileFixture(`
        import { ActionBus, DoxaApplication, Feature, Query } from '@doxajs/core'

        class ActionInvoker {
          constructor(readonly actions: ActionBus) {}
        }
        class InvalidQuery extends Query<void, void> {
          static readonly id = 'invalid'
          static override readonly access = 'public'
          private readonly invoker = this.inject(ActionInvoker)
          handle(): void { void this.invoker }
        }
        class AppFeature extends Feature { id = 'app'; queries = [InvalidQuery] }
        export class Application extends DoxaApplication {
          id = 'nested-action-transitive-query'
          features = [AppFeature]
        }
      `),
    ).rejects.toThrow('query:app/invalid -> service:app/action-invoker -> doxa:action-bus')

    await expect(
      compileFixture(`
        import { ActionBus, DoxaApplication, Feature, Job } from '@doxajs/core'

        class ActionInvoker {
          constructor(readonly actions: ActionBus) {}
        }
        class InvalidJob extends Job<void> {
          static readonly id = 'invalid'
          static override readonly access = 'public'
          private readonly invoker = this.inject(ActionInvoker)
          handle(_input: void): void { void this.invoker }
        }
        class AppFeature extends Feature { id = 'app'; jobs = [InvalidJob] }
        export class Application extends DoxaApplication {
          id = 'nested-action-transitive-job'
          features = [AppFeature]
        }
      `),
    ).rejects.toThrow('job:app/invalid -> service:app/action-invoker -> doxa:action-bus')
  })

  it('checks shared service graphs without revisiting exponentially many paths', async () => {
    const lastLayer = 23
    const services = Array.from({ length: lastLayer + 1 }, (_, index) => {
      if (index === lastLayer) {
        return `class Shared${index}A {}\nclass Shared${index}B {}`
      }
      return `
        class Shared${index}A {
          constructor(readonly left: Shared${index + 1}A, readonly right: Shared${index + 1}B) {}
        }
        class Shared${index}B {
          constructor(readonly left: Shared${index + 1}A, readonly right: Shared${index + 1}B) {}
        }
      `
    }).join('\n')

    const result = await compileFixture(`
      import { DoxaApplication, Feature, Query } from '@doxajs/core'

      ${services}

      class SharedGraphQuery extends Query<void, void> {
        static readonly id = 'shared-graph'
        static override readonly access = 'public'
        private readonly shared = this.inject(Shared0A)
        handle(): void { void this.shared }
      }
      class AppFeature extends Feature { id = 'app'; queries = [SharedGraphQuery] }
      export class Application extends DoxaApplication {
        id = 'shared-service-graph'
        features = [AppFeature]
      }
    `)

    expect(result.manifest.queries).toEqual([
      expect.objectContaining({ id: 'query:app/shared-graph' }),
    ])
  })

  it('reports handbook-linked provider, service, and canonical-folder advisories at compilation', async () => {
    const result = await compileFixture(
      `
        import { DoxaApplication, Feature } from '@doxajs/core'
        import { MisplacedEvent } from './queries/misplaced-event.js'
        import { DatabaseService } from './services/database-service.js'
        import { NotificationProvider } from './providers/notification-provider.js'

        class AppFeature extends Feature {
          id = 'app'
          events = [MisplacedEvent]
          providers = [DatabaseService]
          provides = [NotificationProvider]
        }
        export class Application extends DoxaApplication {
          id = 'architecture-advisories'
          features = [AppFeature]
        }
      `,
      {
        'queries/misplaced-event.ts': `
          import { Event } from '@doxajs/core'
          export class MisplacedEvent extends Event<void> {
            static readonly id = 'misplaced'
          }
        `,
        'services/database-service.ts': `
          export class DatabaseService { static readonly id = 'database' }
        `,
        'providers/notification-provider.ts': `
          export class NotificationProvider {}
        `,
      },
    )

    expect(result.advisories).toEqual([
      expect.objectContaining({
        code: 'DOXA-GNOSIS-STRUCTURE-005',
        componentId: 'event:app/misplaced',
        guideId: 'diagnostic.canonical-folder',
      }),
      expect.objectContaining({
        code: 'DOXA-GNOSIS-STRUCTURE-002',
        componentId: 'provider:app/database',
        guideId: 'diagnostic.provider-service-location',
      }),
      expect.objectContaining({
        code: 'DOXA-GNOSIS-STRUCTURE-004',
        componentId: 'provider:app/database',
        guideId: 'diagnostic.provider-service-location',
      }),
      expect.objectContaining({
        code: 'DOXA-GNOSIS-STRUCTURE-001',
        componentId: 'service:app/notification-provider',
        guideId: 'diagnostic.provider-service-location',
      }),
      expect.objectContaining({
        code: 'DOXA-GNOSIS-STRUCTURE-003',
        componentId: 'service:app/notification-provider',
        guideId: 'diagnostic.provider-service-location',
      }),
    ])
    expect(result.advisories).toEqual(inspectArchitectureDiagnostics(result.manifest).items)
  })

  it('ignores role-like Feature directories with or without a canonical role subfolder', async () => {
    const result = await compileFixture(
      `
        import { DoxaApplication, Feature } from '@doxajs/core'
        import { DirectJobCreated } from './features/jobs/direct-job-created.js'
        import { JobCreated } from './features/jobs/events/job-created.js'
        import { DirectNotificationSender } from './features/providers/direct-notification-sender.js'
        import { NotificationSender } from './features/providers/services/notification-sender.js'

        class AppFeature extends Feature {
          id = 'app'
          events = [DirectJobCreated, JobCreated]
          provides = [DirectNotificationSender, NotificationSender]
        }
        export class Application extends DoxaApplication {
          id = 'canonical-role-folders'
          features = [AppFeature]
        }
      `,
      {
        'features/jobs/direct-job-created.ts': `
          import { Event } from '@doxajs/core'
          export class DirectJobCreated extends Event<void> {
            static readonly id = 'direct-job-created'
          }
        `,
        'features/jobs/events/job-created.ts': `
          import { Event } from '@doxajs/core'
          export class JobCreated extends Event<void> {
            static readonly id = 'job-created'
          }
        `,
        'features/providers/direct-notification-sender.ts': `
          export class DirectNotificationSender {}
        `,
        'features/providers/services/notification-sender.ts': `
          export class NotificationSender {}
        `,
      },
    )

    expect(result.advisories).toEqual([])
    expect(inspectArchitectureDiagnostics(result.manifest).items).toEqual([])
  })

  it('links scope and lifecycle compiler diagnostics to the matching handbook guides', async () => {
    await expect(
      compileFixture(`
        import { DoxaApplication, Feature, type ExecutionScoped } from '@doxajs/core'

        class RequestCache implements ExecutionScoped {}
        class InvalidProvider {
          static readonly id = 'invalid-provider'
          constructor(readonly cache: RequestCache) {}
        }
        class AppFeature extends Feature { id = 'app'; providers = [InvalidProvider] }
        export class Application extends DoxaApplication {
          id = 'invalid-provider-scope'
          features = [AppFeature]
        }
      `),
    ).rejects.toThrow(
      '[DOXA-COMPILER-SCOPE-001] Singleton provider:app/invalid-provider cannot depend on execution-scoped service:app/request-cache. See Gnosis guide concept.providers-provides.',
    )

    await expect(
      compileFixture(`
        import { DoxaApplication, Feature, Job, type LifecycleContext, type Starts } from '@doxajs/core'

        class InvalidJob extends Job<void> implements Starts {
          static readonly id = 'invalid'
          static override readonly access = 'public'
          start(_context: LifecycleContext): void {}
          handle(_input: void): void {}
        }
        class AppFeature extends Feature { id = 'app'; jobs = [InvalidJob] }
        export class Application extends DoxaApplication {
          id = 'invalid-job-lifecycle'
          features = [AppFeature]
        }
      `),
    ).rejects.toThrow(
      '[DOXA-COMPILER-LIFECYCLE-001] InvalidJob may define dispose(), but jobs cannot own application lifecycle phases. See Gnosis guide role.job.',
    )

    await expect(
      compileFixture(`
        import { DoxaApplication, Feature, type LifecycleContext, type Starts } from '@doxajs/core'

        class InvalidService implements Starts {
          start(_context: LifecycleContext): void {}
        }
        class AppFeature extends Feature { id = 'app'; provides = [InvalidService] }
        export class Application extends DoxaApplication {
          id = 'invalid-service-lifecycle'
          features = [AppFeature]
        }
      `),
    ).rejects.toThrow(
      '[DOXA-COMPILER-LIFECYCLE-001] InvalidService may define dispose(), but ordinary services cannot own application lifecycle phases. See Gnosis guide role.service.',
    )

    const validService = await compileFixture(`
      import { DoxaApplication, Feature } from '@doxajs/core'

      class CampaignService {
        start(id: string): string { return id }
        drain(id: string): string { return id }
        stop(id: string): string { return id }
        dispose(id: string): string { return id }
      }
      class AppFeature extends Feature { id = 'app'; provides = [CampaignService] }
      export class Application extends DoxaApplication {
        id = 'valid-service-method-names'
        features = [AppFeature]
      }
    `)
    expect(
      validService.manifest.providers.find(
        (provider) => provider.id === 'service:app/campaign-service',
      )?.lifecycle,
    ).toEqual({ start: false, drain: false, stop: false, dispose: false })
  })

  it('composes an application PermissionSource with resource policies once per execution', async () => {
    const runtime = await bootRuntime()
    const result = await runtime.admit(
      {
        actor: { kind: 'user', id: 'permission-user' },
        transport: { kind: 'test' },
      },
      async () => ({
        details: await runtime.queries.execute(ContactDetails, undefined),
        read: await runtime.authorization.decide('contact.read'),
        update: await runtime.authorization.decide('contact.update', {
          ownerId: 'permission-user',
        }),
        narrowed: await runtime.authorization.decide('contact.update', {
          ownerId: 'different-user',
        }),
      }),
    )

    expect(result).toEqual({
      details: 'contact-details',
      read: {
        effect: 'allow',
        policy: 'permission-source:authorization/application',
        code: 'permission_granted',
      },
      update: {
        effect: 'allow',
        policy: 'policy:authorization/contact',
        code: 'allowed',
      },
      narrowed: {
        effect: 'deny',
        policy: 'policy:authorization/contact',
        code: 'contact_owner_required',
      },
    })
    expect(referenceTelemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'metric',
          name: 'doxa.authorization.decisions',
          attributes: expect.objectContaining({
            ability: 'contact.read',
            effect: 'allow',
            policy: 'permission-source:authorization/application',
            code: 'permission_granted',
          }),
        }),
      ]),
    )
    const permissionObservations = referenceObservations.filter(
      (observation) => observation.name === 'permission-source:authorization/application',
    )
    expect(permissionObservations.length).toBeGreaterThan(0)
    expect(JSON.stringify(permissionObservations)).not.toContain('"contact.read"')
    expect(
      operationLog.filter((entry) => entry.startsWith('permission-source:resolve:')),
    ).toHaveLength(1)

    const missingPermission = await runtime
      .admit(
        {
          actor: { kind: 'user', id: 'read-only-user' },
          transport: { kind: 'test' },
        },
        () => runtime.authorization.authorize('contact.update', { ownerId: 'read-only-user' }),
      )
      .catch((error: unknown) => error)
    expect(missingPermission).toBeInstanceOf(AuthorizationError)
    expect((missingPermission as AuthorizationError).decision).toEqual({
      effect: 'deny',
      policy: 'permission-source:authorization/application',
      code: 'permission_required',
    })
    expect(
      operationLog.filter((entry) => entry.startsWith('permission-source:resolve:')),
    ).toHaveLength(2)

    await expect(
      runtime.admit(
        {
          actor: { kind: 'user', id: 'no-permission-user' },
          transport: { kind: 'test' },
        },
        () => runtime.queries.execute(ContactDetails, undefined),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError)

    const sourceFailure = await runtime.admit(
      {
        actor: { kind: 'user', id: 'permission-source-error' },
        transport: { kind: 'test' },
      },
      () => runtime.queries.execute(ContactDetails, undefined).catch((error: unknown) => error),
    )
    expect(sourceFailure).toBeInstanceOf(Error)
    expect((sourceFailure as Error).message).toBe('Permission source unavailable.')
    const recordedPermissionFailure = JSON.stringify(referenceObservations)
    expect(recordedPermissionFailure).toContain('Permission source failed.')
    expect(recordedPermissionFailure).not.toContain('Permission source unavailable.')

    const primitiveFailure = await runtime
      .admit(
        {
          actor: { kind: 'user', id: 'permission-source-primitive-error' },
          transport: { kind: 'test' },
        },
        () => runtime.queries.execute(ContactDetails, undefined),
      )
      .catch((error: unknown) => error)
    expect(primitiveFailure).toBe('primitive permission source details')
    expect(JSON.stringify(referenceObservations)).not.toContain(
      'primitive permission source details',
    )

    const resolutionsBeforeConcurrent = operationLog.filter((entry) =>
      entry.startsWith('permission-source:resolve:'),
    ).length
    const concurrent = await runtime.admit(
      {
        actor: { kind: 'user', id: 'permission-user' },
        transport: { kind: 'test' },
      },
      () =>
        Promise.all([
          runtime.authorization.decide('contact.read'),
          runtime.authorization.decide('contact.update', { ownerId: 'permission-user' }),
        ]),
    )
    expect(concurrent.map((decision) => decision.effect)).toEqual(['allow', 'allow'])
    expect(
      operationLog.filter((entry) => entry.startsWith('permission-source:resolve:')),
    ).toHaveLength(resolutionsBeforeConcurrent + 1)

    const resolutionsBeforeConstraint = operationLog.filter((entry) =>
      entry.startsWith('permission-source:resolve:'),
    ).length
    const constrained = await runtime.admit(
      {
        actor: { kind: 'user', id: 'permission-user' },
        authentication: {
          state: 'authenticated',
          identityId: 'permission-user',
          method: 'bearer',
          constraints: ['contact.read'],
        },
        transport: { kind: 'test' },
      },
      () => runtime.authorization.decide('contact.update', { ownerId: 'permission-user' }),
    )
    expect(constrained).toEqual({
      effect: 'deny',
      policy: 'doxa:credential-constraints',
      code: 'credential_constraint_denied',
    })
    expect(
      operationLog.filter((entry) => entry.startsWith('permission-source:resolve:')),
    ).toHaveLength(resolutionsBeforeConstraint)

    await expect(
      runtime.admit(
        {
          actor: { kind: 'user', id: 'undeclared-user' },
          transport: { kind: 'test' },
        },
        () => runtime.queries.execute(ContactDetails, undefined),
      ),
    ).rejects.toThrow(
      'Permission source permission-source:authorization/application returned an ability outside its declared catalog',
    )
    expect(JSON.stringify(referenceObservations)).not.toContain('contact.delete')
    await runtime.shutdown()
  })

  it('rejects recursive source-managed authorization', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compileApplication({
      tsconfigPath: path.join(referenceApplication, 'tsconfig.json'),
      applicationFile: path.join(referenceApplication, 'src/recursive-permission-application.ts'),
      sourceRoot: path.join(referenceApplication, 'src'),
      outputRoot: path.join(referenceApplication, 'dist'),
      artifactsDirectory,
    })
    const runtime = await Doxa.boot(RecursivePermissionApplication, {
      artifactsDirectory,
      dotenvPath: false,
      environment: {},
    })

    await expect(
      runtime.admit(
        {
          actor: { kind: 'user', id: 'recursive-permission-user' },
          transport: { kind: 'test' },
        },
        () => runtime.queries.execute(RecursiveContactDetails, undefined),
      ),
    ).rejects.toThrow(
      'Permission source permission-source:recursive-authorization/recursive attempted recursive authorization while resolving abilities',
    )
    await runtime.shutdown()
  })

  it('rejects multiple application PermissionSources at compile time', async () => {
    await expect(
      compileFixture(`
        import {
          DoxaApplication, Feature, PermissionSource, type PermissionSourceRequest,
        } from '@doxajs/core'

        class FirstSource extends PermissionSource {
          static readonly id = 'first'
          static readonly abilities = ['contact.read']
          resolve(_request: PermissionSourceRequest) { return [] }
        }
        class SecondSource extends PermissionSource {
          static readonly id = 'second'
          static readonly abilities = ['contact.read']
          resolve(_request: PermissionSourceRequest) { return [] }
        }
        class FirstFeature extends Feature {
          id = 'first'
          permissionSources = [FirstSource]
        }
        class SecondFeature extends Feature {
          id = 'second'
          permissionSources = [SecondSource]
        }
        export class Application extends DoxaApplication {
          id = 'multiple-permission-sources'
          features = [FirstFeature, SecondFeature]
        }
      `),
    ).rejects.toThrow('Applications may select at most one PermissionSource')
  })

  it('rejects duplicate and invalid PermissionSource ability catalogs', async () => {
    await expect(
      compileFixture(`
        import {
          DoxaApplication, Feature, PermissionSource, type PermissionSourceRequest,
        } from '@doxajs/core'

        class DuplicateSource extends PermissionSource {
          static readonly id = 'duplicate'
          static readonly abilities = ['contact.read', 'contact.read']
          resolve(_request: PermissionSourceRequest) { return [] }
        }
        class AuthorizationFeature extends Feature {
          id = 'authorization'
          permissionSources = [DuplicateSource]
        }
        export class Application extends DoxaApplication {
          id = 'duplicate-permission-abilities'
          features = [AuthorizationFeature]
        }
      `),
    ).rejects.toThrow('DuplicateSource.abilities must not contain duplicates')

    await expect(
      compileFixture(`
        import {
          DoxaApplication, Feature, PermissionSource, type PermissionSourceRequest,
        } from '@doxajs/core'

        class InvalidSource extends PermissionSource {
          static readonly id = 'invalid'
          static readonly abilities = ['Contact Read']
          resolve(_request: PermissionSourceRequest) { return [] }
        }
        class AuthorizationFeature extends Feature {
          id = 'authorization'
          permissionSources = [InvalidSource]
        }
        export class Application extends DoxaApplication {
          id = 'invalid-permission-abilities'
          features = [AuthorizationFeature]
        }
      `),
    ).rejects.toThrow('InvalidSource declares invalid ability Contact Read')
  })

  it('boots only from artifacts and follows dependency-derived lifecycle order', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compile(artifactsDirectory)

    const runtime = await Doxa.boot(Application, {
      artifactsDirectory,
      dotenvPath: false,
      environment: {
        APP_ENVIRONMENT: 'production',
        APP_PORT: '4100',
        WORKER_CONCURRENCY: '4',
      },
    })

    expect(runtime.ready).toBe(true)
    expect(runtime.state).toBe('ready')
    expect(lifecycleLog).toEqual(['start:database:production:4100:frozen=true', 'start:worker:4'])

    const firstShutdown = runtime.shutdown()
    const secondShutdown = runtime.shutdown()
    expect(secondShutdown).toBe(firstShutdown)
    await firstShutdown

    expect(runtime.state).toBe('stopped')
    expect(lifecycleLog).toEqual([
      'start:database:production:4100:frozen=true',
      'start:worker:4',
      'drain:worker',
      'drain:database',
      'stop:worker',
      'stop:database',
      'dispose:worker',
      'dispose:database',
    ])
  })

  it('seals the model-reader profile to the transaction-provider lifecycle closure', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compile(artifactsDirectory)
    const runtime = await Doxa.boot(Application, {
      artifactsDirectory,
      profile: 'model-reader',
      dotenvPath: false,
      environment: {
        APP_PORT: 'not-a-number',
        WORKER_CONCURRENCY: 'not-a-number',
      },
    })

    expect(runtime.profile).toBe('model-reader')
    expect(lifecycleLog).toEqual([])
    await expect(
      runtime.admit(
        { actor: { kind: 'system', id: 'not-a-model-query' }, transport: { kind: 'test' } },
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(ExecutionAdmissionError)
    await expect(
      runtime.queryModelRecords(
        { modelId: 'model:missing', fields: ['id'] },
        { actor: { kind: 'system', id: 'model-reader' }, transport: { kind: 'test' } },
      ),
    ).rejects.toThrow('authenticated system console execution')
    await expect(
      runtime.queryModelRecords(
        { modelId: 'model:missing', fields: ['id'] },
        {
          actor: { kind: 'system', id: 'model-reader' },
          authentication: {
            state: 'authenticated',
            identityId: 'model-reader',
            method: 'console',
          },
          transport: { kind: 'console', name: 'model-reader' },
        },
      ),
    ).rejects.toThrow('model:missing is not a declared model')
    await runtime.shutdown()
    expect(lifecycleLog).toEqual([])

    await expect(
      Doxa.boot(Application, {
        artifactsDirectory,
        profile: 'unknown' as 'application',
        dotenvPath: false,
        environment: {},
      }),
    ).rejects.toThrow('Unknown Doxa runtime profile unknown')
  })

  it('preserves startup failure and unwinds successfully started dependencies', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compile(artifactsDirectory)
    const signalListeners = {
      sigint: process.listenerCount('SIGINT'),
      sigterm: process.listenerCount('SIGTERM'),
    }

    await expect(
      Doxa.boot(Application, {
        artifactsDirectory,
        dotenvPath: false,
        environment: { WORKER_FAIL_STARTUP: 'true' },
      }),
    ).rejects.toMatchObject({
      name: RuntimeBootError.name,
      primaryError: expect.objectContaining({
        message: 'Reference worker startup failed.',
      }),
      cleanupErrors: [],
    })

    expect(lifecycleLog).toEqual([
      'start:database:development:3000:frozen=true',
      'start:worker:2',
      'stop:database',
      'dispose:database',
    ])
    expect(process.listenerCount('SIGINT')).toBe(signalListeners.sigint)
    expect(process.listenerCount('SIGTERM')).toBe(signalListeners.sigterm)
  })

  it('aggregates configuration failures before constructing singleton services', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compile(artifactsDirectory)

    await expect(
      Doxa.boot(Application, {
        artifactsDirectory,
        dotenvPath: false,
        environment: {
          APP_ENVIRONMENT: 'staging',
          APP_PORT: 'not-a-number',
        },
      }),
    ).rejects.toMatchObject({
      name: ConfigurationValidationError.name,
      issues: expect.arrayContaining([
        expect.stringContaining('AppConfig.environment'),
        expect.stringContaining('AppConfig.port'),
      ]),
    })
    expect(lifecycleLog).toEqual([])
  })

  it('fails closed when manifest and registry integrity diverge', async () => {
    const artifactsDirectory = await temporaryDirectory()
    const result = await compile(artifactsDirectory)
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    manifest.buildHash = 'stale-build-hash'
    await writeFile(result.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    await expect(
      Doxa.boot(Application, {
        artifactsDirectory,
        dotenvPath: false,
        environment: {},
      }),
    ).rejects.toBeInstanceOf(RuntimeIntegrityError)
  })

  it('fails closed when semantic manifest content is modified', async () => {
    const artifactsDirectory = await temporaryDirectory()
    const result = await compile(artifactsDirectory)
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
      actions: Array<{ transactional: boolean }>
    }
    manifest.actions[0]!.transactional = false
    await writeFile(result.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    await expect(
      Doxa.boot(Application, {
        artifactsDirectory,
        dotenvPath: false,
        environment: {},
      }),
    ).rejects.toThrow('manifest content does not match its build hash')
  })

  it('rejects stale manifest formats before interpreting new graph sections', async () => {
    const artifactsDirectory = await temporaryDirectory()
    const result = await compile(artifactsDirectory)
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
      formatVersion: number
    }
    const expectedFormatVersion = manifest.formatVersion
    manifest.formatVersion = expectedFormatVersion - 1
    await writeFile(result.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    await expect(
      Doxa.boot(Application, {
        artifactsDirectory,
        dotenvPath: false,
        environment: {},
      }),
    ).rejects.toThrow(
      `Unsupported Doxa manifest format ${expectedFormatVersion - 1}; expected ${expectedFormatVersion}`,
    )
  })

  it('rejects invalid optional model attributes before runtime boot', async () => {
    const artifactsDirectory = await temporaryDirectory()
    const result = await compile(artifactsDirectory)
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
      models: unknown[]
    }
    manifest.models.push({
      id: 'model:test/item',
      attributes: ['id'],
      attributeTypes: {
        id: { kind: 'string', nullable: false, optional: false },
      },
      relationships: [],
      storage: {
        kind: 'table',
        table: 'items',
        primaryKey: 'id',
        columns: { id: 'id' },
        attributeTypes: {
          id: { kind: 'string', nullable: false, optional: false },
        },
        timestamps: false,
        managed: true,
        readOnly: false,
        versionSource: { kind: 'xmin' },
        optionalAttributes: ['not-declared'],
      },
      source: { file: 'test.ts', line: 1, column: 1 },
    })

    expect(() => assertManifest(manifest)).toThrow('invalid optional attributes')
  })

  it('rejects incomplete model storage contracts before runtime boot', async () => {
    const artifactsDirectory = await temporaryDirectory()
    const result = await compile(artifactsDirectory)
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
      models: unknown[]
    }
    manifest.models.push({
      id: 'model:test/item',
      attributes: ['id'],
      attributeTypes: {
        id: { kind: 'string', nullable: false, optional: false },
      },
      relationships: [],
      storage: { kind: 'table' },
      source: { file: 'test.ts', line: 1, column: 1 },
    })

    expect(() => assertManifest(manifest)).toThrow('invalid table projection contract')
  })

  it('rejects invalid permission-source manifest catalogs before runtime boot', async () => {
    const artifactsDirectory = await temporaryDirectory()
    const result = await compile(artifactsDirectory)
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
      permissionSource: { abilities: string[] }
    }
    manifest.permissionSource.abilities = ['contact.read', 'contact.read']

    expect(() => assertManifest(manifest)).toThrow('permission source')
  })

  it('rejects an Application constructor that does not match the generated registry', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compile(artifactsDirectory)
    class DifferentApplication extends Application {}

    await expect(
      Doxa.boot(DifferentApplication, {
        artifactsDirectory,
        dotenvPath: false,
        environment: {},
      }),
    ).rejects.toThrow('not the Application passed to Doxa.boot()')
  })

  it('shares one execution-scoped service across actions and queries', async () => {
    const runtime = await bootRuntime()
    const result = await runtime.admit(
      {
        actor: { kind: 'user', id: 'user-1' },
        transport: { kind: 'test' },
      },
      async (context) => {
        expect(Object.isFrozen(context)).toBe(true)
        expect(Object.isFrozen(context.actor)).toBe(true)
        expect(context.initiator).toEqual(context.actor)
        expect(context.correlationId).toBe(context.executionId)

        const first = await runtime.actions.execute(IncrementCounter, { amount: 2 })
        const read = await runtime.queries.execute(ReadCounter, undefined)
        const second = await runtime.actions.execute(IncrementCounter, { amount: 3 })
        return { context, values: [first, read, second] }
      },
    )

    expect(result.values).toEqual([2, 2, 5])
    expect(operationLog).toEqual([
      `transaction:begin:${result.context.executionId}`,
      `transaction:commit:${result.context.executionId}`,
      `transaction:begin:${result.context.executionId}`,
      `transaction:commit:${result.context.executionId}`,
      'execution-counter:dispose:5',
    ])
    await runtime.shutdown()
  })

  it('isolates concurrent executions and gives each a new execution ID', async () => {
    const runtime = await bootRuntime()
    const executions = await Promise.all([
      runtime.admit(
        {
          actor: { kind: 'service', id: 'first' },
          transport: { kind: 'test' },
        },
        async (context) => ({
          id: context.executionId,
          value: await runtime.actions.execute(IncrementCounter, { amount: 1, delay: 15 }),
        }),
      ),
      runtime.admit(
        {
          actor: { kind: 'service', id: 'second' },
          transport: { kind: 'test' },
        },
        async (context) => ({
          id: context.executionId,
          value: await runtime.actions.execute(IncrementCounter, { amount: 10 }),
        }),
      ),
    ])

    expect(executions.map((execution) => execution.value)).toEqual([1, 10])
    expect(new Set(executions.map((execution) => execution.id)).size).toBe(2)
    expect(operationLog).toEqual(
      expect.arrayContaining(['execution-counter:dispose:1', 'execution-counter:dispose:10']),
    )
    await runtime.shutdown()
  })

  it('rolls back failed actions and disposes their execution scope', async () => {
    const runtime = await bootRuntime()
    let executionId = ''

    await expect(
      runtime.admit(
        {
          actor: { kind: 'system', id: 'failure-test' },
          transport: { kind: 'test' },
        },
        async (context) => {
          executionId = context.executionId
          return runtime.actions.execute(FailCounter, 7)
        },
      ),
    ).rejects.toThrow('Counter action failed.')

    expect(operationLog).toEqual([
      `transaction:begin:${executionId}`,
      `transaction:rollback:${executionId}`,
      'execution-counter:dispose:7',
    ])
    await runtime.shutdown()
  })

  it('marks query execution read-only for framework-managed mutation paths', async () => {
    const runtime = await bootRuntime()

    await expect(
      runtime.admit(
        {
          actor: { kind: 'system', id: 'read-only-test' },
          transport: { kind: 'test' },
        },
        () => runtime.queries.execute(MutateCounterQuery, 3),
      ),
    ).rejects.toBeInstanceOf(ReadOnlyExecutionError)

    expect(operationLog).toEqual(['execution-counter:dispose:0'])
    await runtime.shutdown()
  })

  it('prohibits action dispatch outside an execution', async () => {
    const runtime = await bootRuntime()
    await expect(runtime.actions.execute(IncrementCounter, { amount: 1 })).rejects.toBeInstanceOf(
      OperationDispatchError,
    )
    await runtime.shutdown()
  })

  it('rejects invalid actors and nested admitted execution scopes', async () => {
    const runtime = await bootRuntime()
    await expect(
      runtime.admit(
        {
          actor: { kind: 'anonymous', id: 'not-allowed' },
          transport: { kind: 'test' },
        },
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(ExecutionAdmissionError)

    await expect(
      runtime.admit(
        {
          actor: { kind: 'system', id: 'outer' },
          transport: { kind: 'test' },
        },
        () =>
          runtime.admit(
            {
              actor: { kind: 'system', id: 'inner' },
              transport: { kind: 'internal' },
            },
            () => undefined,
          ),
      ),
    ).rejects.toThrow('cannot create a nested execution scope')
    await runtime.shutdown()
  })

  it('stops admission during drain and waits for accepted execution work', async () => {
    const runtime = await bootRuntime()
    let release!: () => void
    let markStarted!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const execution = runtime.admit(
      {
        actor: { kind: 'system', id: 'drain-test' },
        transport: { kind: 'test' },
      },
      async () => {
        markStarted()
        await gate
        return 'complete'
      },
    )
    await started

    const shutdown = runtime.shutdown()
    expect(runtime.state).toBe('draining')
    await expect(
      runtime.admit(
        {
          actor: { kind: 'system', id: 'too-late' },
          transport: { kind: 'test' },
        },
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(ExecutionAdmissionError)
    release()

    await expect(execution).resolves.toBe('complete')
    await shutdown
    expect(runtime.state).toBe('stopped')
  })

  it('propagates execution deadlines through the cancellation signal', async () => {
    const runtime = await bootRuntime()
    const aborted = await runtime.admit(
      {
        actor: { kind: 'system', id: 'deadline-test' },
        transport: { kind: 'test' },
        deadline: new Date(Date.now() + 10),
      },
      async (context) => {
        if (!context.cancellation.aborted) {
          await new Promise<void>((resolve) => {
            context.cancellation.addEventListener('abort', () => resolve(), { once: true })
          })
        }
        return context.cancellation.aborted
      },
    )

    expect(aborted).toBe(true)
    await runtime.shutdown()
  })
})

function modelQuerySession() {
  return {
    active: true,
    query: () => Promise.resolve([]),
    queryValues: () => Promise.resolve([]),
    queryAggregate: () => Promise.resolve(0),
    paginate: () => Promise.resolve({ items: [], page: 1, perPage: 1, total: 0, lastPage: 1 }),
    cursorPaginate: () => Promise.resolve({ items: [] }),
  }
}

async function collect<Value>(values: AsyncIterable<Value>): Promise<readonly Value[]> {
  const collected: Value[] = []
  for await (const value of values) collected.push(value)
  return collected
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'doxa-foundation-'))
  temporaryDirectories.push(directory)
  return directory
}

async function compile(artifactsDirectory: string) {
  return compileApplication({
    tsconfigPath: path.join(referenceApplication, 'tsconfig.json'),
    applicationFile: path.join(referenceApplication, 'src/application.ts'),
    sourceRoot: path.join(referenceApplication, 'src'),
    outputRoot: path.join(referenceApplication, 'dist'),
    artifactsDirectory,
  })
}

async function compileFixture(source: string, files: Readonly<Record<string, string>> = {}) {
  const root = await mkdtemp(path.join(workspace, '.foundation-fixture-'))
  temporaryDirectories.push(root)
  await mkdir(path.join(root, 'src'))
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      extends: path.join(workspace, 'tsconfig.base.json'),
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
  await writeFile(path.join(root, 'src/application.ts'), source)
  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(root, 'src', relativePath)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  return await compileApplication({
    tsconfigPath: path.join(root, 'tsconfig.json'),
    applicationFile: path.join(root, 'src/application.ts'),
    sourceRoot: path.join(root, 'src'),
    outputRoot: path.join(root, 'dist'),
    artifactsDirectory: path.join(root, '.doxa'),
  })
}

async function bootRuntime() {
  const artifactsDirectory = await temporaryDirectory()
  await compile(artifactsDirectory)
  return Doxa.boot(Application, {
    artifactsDirectory,
    dotenvPath: false,
    environment: {},
  })
}
