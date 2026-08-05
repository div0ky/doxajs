import ts from 'typescript'

import { DoxaCompilationError } from './errors.js'

export const supportedPluginPackages = [
  '@doxajs/opentelemetry',
  '@doxajs/sendgrid',
  '@doxajs/theoria',
  '@doxajs/twilio-sms',
] as const

export interface PreparedApplication {
  readonly applicationId: string
  readonly plugins: readonly string[]
  readonly source: string
}

export function prepareFrameworkSource(fileName: string, sourceText: string): PreparedApplication {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const diagnostics =
    (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? []
  if (diagnostics.length > 0) {
    throw new DoxaCompilationError(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (value) => value,
        getCurrentDirectory: () => '',
        getNewLine: () => '\n',
      }),
    )
  }
  const application = sourceFile.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) &&
      statement.name?.text === 'Application' &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
        true,
  )
  if (!application) {
    throw new DoxaCompilationError(`Expected exported Application class in ${fileName}.`)
  }
  const applicationId = requiredStringProperty(application, 'id')
  const plugins = stringArrayProperty(application, 'plugins')
  for (const plugin of plugins) {
    if (!(supportedPluginPackages as readonly string[]).includes(plugin)) {
      throw new DoxaCompilationError(
        `Unsupported Doxa plugin ${plugin}. Supported plugins: ${supportedPluginPackages.join(', ')}.`,
      )
    }
  }
  if (new Set(plugins).size !== plugins.length) {
    throw new DoxaCompilationError('Application plugins must be unique.')
  }

  const framework = objectProperty(application, 'framework')
  const database = framework ? nestedObject(framework, 'database') : undefined
  const auth = framework ? nestedObject(framework, 'auth') : undefined
  const identity = auth ? nestedObject(auth, 'identity') : undefined
  const impersonation = auth ? nestedObject(auth, 'impersonation') : undefined
  const queue = framework ? nestedObject(framework, 'queue') : undefined
  const broadcasting = framework ? nestedObject(framework, 'broadcasting') : undefined
  const theoria = framework ? nestedObject(framework, 'theoria') : undefined
  const localConcurrency = queue ? optionalPositiveNumber(queue, 'localConcurrency') : undefined
  const outboxPollingMilliseconds = queue
    ? optionalPositiveNumber(queue, 'outboxPollingMilliseconds')
    : undefined
  const theoriaProfile = theoria
    ? (optionalString(theoria, 'profile') ?? 'development')
    : 'development'
  if (!['development', 'production-diagnostics'].includes(theoriaProfile)) {
    throw new DoxaCompilationError('Theoria profile must be development or production-diagnostics.')
  }
  const theoriaOverflowPolicy = theoria
    ? (optionalString(theoria, 'overflowPolicy') ?? 'drop-newest')
    : 'drop-newest'
  if (!['drop-oldest', 'drop-newest'].includes(theoriaOverflowPolicy)) {
    throw new DoxaCompilationError('Theoria overflowPolicy must be drop-oldest or drop-newest.')
  }
  const theoriaIncludeKinds = theoria ? optionalStringArray(theoria, 'includeKinds') : undefined
  const observationKinds = [
    'execution',
    'http',
    'action',
    'query',
    'transaction',
    'model',
    'event',
    'broadcast',
    'listener',
    'reaction',
    'signal',
    'job',
    'schedule',
    'authorization',
    'cache',
    'mail',
    'sms',
    'log',
    'ai.operation',
    'ai.tool',
    'ai.critic',
    'ai.retry',
    'exception',
  ]
  if (theoriaIncludeKinds?.some((kind) => !observationKinds.includes(kind))) {
    throw new DoxaCompilationError('Theoria includeKinds contains an unsupported observation kind.')
  }
  const theoriaIncludePhases = theoria ? optionalStringArray(theoria, 'includePhases') : undefined
  if (
    theoriaIncludePhases?.some(
      (phase) => !['started', 'completed', 'failed', 'occurred'].includes(phase),
    )
  ) {
    throw new DoxaCompilationError('Theoria includePhases contains an unsupported phase.')
  }
  const theoriaMinimumDurationMilliseconds = theoria
    ? optionalNonNegativeNumber(theoria, 'minimumDurationMilliseconds')
    : undefined
  if (
    theoriaMinimumDurationMilliseconds !== undefined &&
    theoriaIncludePhases &&
    !['started', 'completed', 'failed'].every((phase) => theoriaIncludePhases.includes(phase))
  ) {
    throw new DoxaCompilationError(
      'Theoria duration filtering requires started, completed, and failed phases.',
    )
  }
  const configuration = {
    applicationName: database
      ? (optionalString(database, 'applicationName') ?? applicationId)
      : applicationId,
    secureCookies: auth ? (optionalBoolean(auth, 'secureCookies') ?? false) : false,
    trustedOrigins: auth
      ? (optionalStringArray(auth, 'trustedOrigins') ?? ['http://127.0.0.1:3000'])
      : ['http://127.0.0.1:3000'],
    identityMode: identity ? requiredNestedString(identity, 'mode') : 'doxa-owned',
    hasContactEmail: identity ? hasObjectProperty(identity, 'contactEmail') : true,
    verificationMode: identityVerificationMode(identity),
    impersonationEnabled: impersonation
      ? (optionalBoolean(impersonation, 'enabled') ?? true)
      : false,
    impersonationSessionSeconds: impersonation
      ? (optionalPositiveInteger(impersonation, 'sessionSeconds') ?? 60 * 60)
      : 60 * 60,
    ...(localConcurrency === undefined ? {} : { localConcurrency }),
    ...(outboxPollingMilliseconds === undefined ? {} : { outboxPollingMilliseconds }),
    broadcastingEnabled: broadcasting ? (optionalBoolean(broadcasting, 'enabled') ?? true) : false,
    theoriaProfile,
    theoriaProductionEnabled: theoria
      ? (optionalBoolean(theoria, 'productionEnabled') ?? false)
      : false,
    theoriaSampleRate: theoria ? (optionalRate(theoria, 'sampleRate') ?? 1) : 1,
    ...(theoriaIncludeKinds ? { theoriaIncludeKinds } : {}),
    ...(theoriaIncludePhases ? { theoriaIncludePhases } : {}),
    ...(theoria && optionalStringArray(theoria, 'includeNames')
      ? { theoriaIncludeNames: optionalStringArray(theoria, 'includeNames')! }
      : {}),
    ...(theoriaMinimumDurationMilliseconds !== undefined
      ? { theoriaMinimumDurationMilliseconds }
      : {}),
    theoriaMaximumPending: theoria
      ? (optionalPositiveInteger(theoria, 'maximumPending') ?? 10_000)
      : 10_000,
    theoriaOverflowPolicy,
    theoriaBatchSize: theoria ? (optionalPositiveInteger(theoria, 'batchSize') ?? 100) : 100,
    theoriaFlushIntervalMilliseconds: theoria
      ? (optionalPositiveInteger(theoria, 'flushIntervalMilliseconds') ?? 100)
      : 100,
    theoriaHotRetentionDays: theoria
      ? (optionalPositiveNumber(theoria, 'hotRetentionDays') ?? 7)
      : 7,
    ...(theoria && optionalPositiveNumber(theoria, 'warmRetentionDays') !== undefined
      ? { theoriaWarmRetentionDays: optionalPositiveNumber(theoria, 'warmRetentionDays')! }
      : {}),
    theoriaMaximumObservations: theoria
      ? (optionalPositiveInteger(theoria, 'maximumObservations') ?? 50_000)
      : 50_000,
    theoriaPoolMaximum: theoria ? (optionalPositiveInteger(theoria, 'poolMaximum') ?? 4) : 4,
    theoriaServiceName: theoria
      ? (optionalString(theoria, 'serviceName') ?? applicationId)
      : applicationId,
    ...(theoria && optionalString(theoria, 'environment')
      ? { theoriaEnvironment: optionalString(theoria, 'environment')! }
      : {}),
    ...(theoria && optionalString(theoria, 'release')
      ? { theoriaRelease: optionalString(theoria, 'release')! }
      : {}),
    ...(theoria && optionalString(theoria, 'instanceId')
      ? { theoriaInstanceId: optionalString(theoria, 'instanceId')! }
      : {}),
  }
  if (
    configuration.theoriaWarmRetentionDays !== undefined &&
    configuration.theoriaWarmRetentionDays <= configuration.theoriaHotRetentionDays
  ) {
    throw new DoxaCompilationError('Theoria warmRetentionDays must exceed hotRetentionDays.')
  }

  return {
    applicationId,
    plugins,
    source: renderFrameworkSource(applicationId, plugins, configuration),
  }
}

function renderFrameworkSource(
  applicationId: string,
  plugins: readonly string[],
  configuration: {
    readonly applicationName: string
    readonly secureCookies: boolean
    readonly trustedOrigins: readonly string[]
    readonly identityMode: string
    readonly hasContactEmail: boolean
    readonly verificationMode: string
    readonly impersonationEnabled: boolean
    readonly impersonationSessionSeconds: number
    readonly localConcurrency?: number
    readonly outboxPollingMilliseconds?: number
    readonly broadcastingEnabled: boolean
    readonly theoriaProfile: string
    readonly theoriaProductionEnabled: boolean
    readonly theoriaSampleRate: number
    readonly theoriaIncludeKinds?: readonly string[]
    readonly theoriaIncludePhases?: readonly string[]
    readonly theoriaIncludeNames?: readonly string[]
    readonly theoriaMinimumDurationMilliseconds?: number
    readonly theoriaMaximumPending: number
    readonly theoriaOverflowPolicy: string
    readonly theoriaBatchSize: number
    readonly theoriaFlushIntervalMilliseconds: number
    readonly theoriaHotRetentionDays: number
    readonly theoriaWarmRetentionDays?: number
    readonly theoriaMaximumObservations: number
    readonly theoriaPoolMaximum: number
    readonly theoriaServiceName: string
    readonly theoriaEnvironment?: string
    readonly theoriaRelease?: string
    readonly theoriaInstanceId?: string
  },
): string {
  const sendgrid = plugins.includes('@doxajs/sendgrid')
  const opentelemetry = plugins.includes('@doxajs/opentelemetry')
  const twilio = plugins.includes('@doxajs/twilio-sms')
  const theoria = plugins.includes('@doxajs/theoria')
  const optionalImports = [
    ...(configuration.broadcastingEnabled ? ["import { Keryx } from '@doxajs/keryx'"] : []),
    ...(opentelemetry ? ["import { DoxaOpenTelemetry } from '@doxajs/opentelemetry'"] : []),
    ...(sendgrid ? ["import { SendGridMailTransport } from '@doxajs/sendgrid'"] : []),
    ...(twilio ? ["import { TwilioSmsTransport } from '@doxajs/twilio-sms'"] : []),
    ...(theoria ? ["import { PostgresTheoria } from '@doxajs/theoria'"] : []),
  ]
  const configs = ['DatabaseConfig', 'AuthConfig']
  const providers = ['Transactions', 'Queues', 'ApplicationAuth', 'ApplicationCache']
  const providerSources: string[] = []
  const managedIdentity = configuration.identityMode !== 'login-only'
  const verificationRoutes =
    managedIdentity && configuration.hasContactEmail && configuration.verificationMode === 'mapped'
  const recoveryRoutes = managedIdentity && configuration.hasContactEmail

  if (configuration.broadcastingEnabled) {
    configs.push('DoxaKeryxConfig')
    providers.push('ApplicationBroadcasting')
    providerSources.push(`export class DoxaKeryxConfig extends Configuration {
  host = '127.0.0.1'
  port = 6001
  path = '/app'
  heartbeatMilliseconds = ${configuration.impersonationEnabled ? '10_000' : '30_000'}
  key = 'default'
  declare secret?: SecretString
  declare publishUrl?: string
  topology: 'single' | 'redis' = 'single'
  declare redisUrl?: SecretString
}

export class ApplicationBroadcasting extends Keryx {
  static override readonly id = 'broadcasting'
  constructor(config: DoxaKeryxConfig) {
    super({
      applicationId: ${JSON.stringify(applicationId)},
      host: config.host,
      port: config.port,
      path: config.path,
      heartbeatMilliseconds: config.heartbeatMilliseconds,
      key: config.key,
      ...(config.secret ? { secret: config.secret.reveal() } : {}),
      ...(config.publishUrl ? { publishUrl: config.publishUrl } : {}),
      topology: config.topology,
      ...(config.redisUrl ? { redisUrl: config.redisUrl.reveal() } : {}),
    })
  }
}`)
  }

  if (opentelemetry) {
    providers.push('ApplicationTelemetry')
    providerSources.push(`export class ApplicationTelemetry extends DoxaOpenTelemetry {
  static override readonly id = 'telemetry'
}`)
  }

  if (sendgrid) {
    configs.push('SendGridConfig')
    providers.push('ApplicationMail')
    providerSources.push(`export class SendGridConfig extends Configuration {
  declare apiKey: SecretString
}

export class ApplicationMail extends SendGridMailTransport {
  static id = 'mail'
  constructor(config: SendGridConfig) { super({ apiKey: config.apiKey.reveal() }) }
}`)
  } else {
    providers.push('ApplicationMail')
    providerSources.push(
      "export class ApplicationMail extends FakeMailTransport { static id = 'mail' }",
    )
  }
  if (twilio) {
    configs.push('TwilioSmsConfig')
    providers.push('ApplicationSms')
    providerSources.push(`export class TwilioSmsConfig extends Configuration {
  declare accountSid: string
  declare authToken: SecretString
  declare messagingServiceSid?: string
  declare statusCallback: string
}

export class ApplicationSms extends TwilioSmsTransport {
  static id = 'sms'
  constructor(config: TwilioSmsConfig) {
    super({
      accountSid: config.accountSid,
      authToken: config.authToken.reveal(),
      ...(config.messagingServiceSid ? { messagingServiceSid: config.messagingServiceSid } : {}),
      statusCallback: config.statusCallback,
    })
  }
}`)
  } else {
    providers.push('ApplicationSms')
    providerSources.push(
      "export class ApplicationSms extends FakeSmsTransport { static id = 'sms' }",
    )
  }
  if (theoria) {
    configs.push('TheoriaConfig')
    providers.push('ApplicationTheoria')
    providerSources.push(`export class TheoriaConfig extends Configuration {
  profile = ${JSON.stringify(configuration.theoriaProfile)}
  productionEnabled = ${configuration.theoriaProductionEnabled}
  sampleRate = ${configuration.theoriaSampleRate}
  ${configuration.theoriaIncludeKinds ? `includeKinds = ${JSON.stringify(configuration.theoriaIncludeKinds)} as const` : ''}
  ${configuration.theoriaIncludePhases ? `includePhases = ${JSON.stringify(configuration.theoriaIncludePhases)} as const` : ''}
  ${configuration.theoriaIncludeNames ? `includeNames = ${JSON.stringify(configuration.theoriaIncludeNames)} as const` : ''}
  ${configuration.theoriaMinimumDurationMilliseconds === undefined ? '' : `minimumDurationMilliseconds = ${configuration.theoriaMinimumDurationMilliseconds}`}
  maximumPending = ${configuration.theoriaMaximumPending}
  overflowPolicy = ${JSON.stringify(configuration.theoriaOverflowPolicy)}
  batchSize = ${configuration.theoriaBatchSize}
  flushIntervalMilliseconds = ${configuration.theoriaFlushIntervalMilliseconds}
  hotRetentionDays = ${configuration.theoriaHotRetentionDays}
  ${configuration.theoriaWarmRetentionDays === undefined ? '' : `warmRetentionDays = ${configuration.theoriaWarmRetentionDays}`}
  maximumObservations = ${configuration.theoriaMaximumObservations}
  poolMaximum = ${configuration.theoriaPoolMaximum}
  serviceName = ${JSON.stringify(configuration.theoriaServiceName)}
  ${configuration.theoriaEnvironment ? `environment = ${JSON.stringify(configuration.theoriaEnvironment)}` : ''}
  ${configuration.theoriaRelease ? `release = ${JSON.stringify(configuration.theoriaRelease)}` : ''}
  ${configuration.theoriaInstanceId ? `instanceId = ${JSON.stringify(configuration.theoriaInstanceId)}` : ''}
}

export class ApplicationTheoria extends PostgresTheoria {
  static override readonly id = 'theoria'
  constructor(database: DatabaseConfig, theoria: TheoriaConfig) {
    super({
      connectionString: database.connectionString.reveal(),
      profile: theoria.profile as 'development' | 'production-diagnostics',
      productionEnabled: theoria.productionEnabled,
      sampleRate: theoria.sampleRate,
      ...('includeKinds' in theoria ? { includeKinds: theoria.includeKinds as readonly import('@doxajs/core').ObservationKind[] } : {}),
      ...('includePhases' in theoria ? { includePhases: theoria.includePhases as readonly import('@doxajs/core').ObservationPhase[] } : {}),
      ...('includeNames' in theoria ? { includeNames: theoria.includeNames as readonly string[] } : {}),
      ...('minimumDurationMilliseconds' in theoria ? { minimumDurationMilliseconds: theoria.minimumDurationMilliseconds as number } : {}),
      maximumPending: theoria.maximumPending,
      overflowPolicy: theoria.overflowPolicy as 'drop-oldest' | 'drop-newest',
      batchSize: theoria.batchSize,
      flushIntervalMilliseconds: theoria.flushIntervalMilliseconds,
      hotRetentionDays: theoria.hotRetentionDays,
      ...('warmRetentionDays' in theoria ? { warmRetentionDays: theoria.warmRetentionDays as number } : {}),
      maximumObservations: theoria.maximumObservations,
      poolMaximum: theoria.poolMaximum,
      ...('environment' in theoria ? { environment: theoria.environment as string } : {}),
      resource: {
        application: ${JSON.stringify(applicationId)},
        service: theoria.serviceName,
        ...('environment' in theoria ? { environment: theoria.environment as string } : {}),
        ...('release' in theoria ? { release: theoria.release as string } : {}),
        ...('instanceId' in theoria ? { instanceId: theoria.instanceId as string } : {}),
      },
    })
  }
}`)
  }

  const queueOptions = [
    `connectionString: config.connectionString.reveal()`,
    `applicationName: ${JSON.stringify(configuration.applicationName)}`,
    ...(configuration.localConcurrency === undefined
      ? []
      : [`localConcurrency: ${configuration.localConcurrency}`]),
    ...(configuration.outboxPollingMilliseconds === undefined
      ? []
      : [`outboxPollingMilliseconds: ${configuration.outboxPollingMilliseconds}`]),
  ].join(', ')

  return `// Generated by @doxajs/compiler. Do not edit.
import { randomUUID } from 'node:crypto'

import {
  Action,
  ActionBus,
  Auth,
  Authorization,
  Configuration,
  CurrentExecution,
  FakeMailTransport,
  FakeSmsTransport,
  Feature,
  Http,
  HttpError,
  type HttpRequest,
  Mailer,
  Policy,
  type PolicyDecision,
  type PolicyRequest,
  Route,
  SecretString,
  allow,
  deny,
  isRecentPasswordAuthentication,
} from '@doxajs/core'
import { PostgresAuth } from '@doxajs/auth-postgres/framework'
import { PostgresCache, PostgresTransactionManager } from '@doxajs/postgres-drizzle'
import { PgBossQueueManager } from '@doxajs/queue-pg-boss'
${optionalImports.join('\n')}

export class DatabaseConfig extends Configuration {
  declare connectionString: SecretString
}

export class AuthConfig extends Configuration {
  secureCookies = ${configuration.secureCookies}
  trustedOrigins = ${JSON.stringify(configuration.trustedOrigins.join(','))}
  impersonationSessionSeconds = ${configuration.impersonationSessionSeconds}
}

export class Transactions extends PostgresTransactionManager {
  static id = 'transactions'
  constructor(config: DatabaseConfig) {
    super({ connectionString: config.connectionString.reveal(), applicationName: ${JSON.stringify(configuration.applicationName)} })
  }
}

export class Queues extends PgBossQueueManager {
  static id = 'queues'
  constructor(config: DatabaseConfig) { super({ ${queueOptions} }) }
}

export class ApplicationAuth extends PostgresAuth {
  static override readonly id = 'auth'
  constructor(database: DatabaseConfig, auth: AuthConfig) {
    super({
      connectionString: database.connectionString.reveal(),
      secureCookies: auth.secureCookies,
      trustedOrigins: auth.trustedOrigins.split(',').map((origin) => origin.trim()).filter(Boolean),
      impersonationSessionSeconds: auth.impersonationSessionSeconds,
    })
  }
}

export class ApplicationCache extends PostgresCache {
  static id = 'cache'
  constructor(config: DatabaseConfig) {
    super({ connectionString: config.connectionString.reveal(), applicationName: ${JSON.stringify(`${configuration.applicationName}-cache`)} })
  }
}

${providerSources.join('\n\n')}

export class HealthRoute extends Route {
  static override readonly id = 'health'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/health'
  handle(_request: HttpRequest) { return { status: 'ok' } }
}

${
  configuration.broadcastingEnabled
    ? `export class BroadcastAuthorizeRoute extends Route {
  static override readonly id = 'broadcast-authorize'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/broadcasting/authorize'
  private readonly broadcasting = this.inject(ApplicationBroadcasting)
  private readonly execution = this.inject(CurrentExecution)
  handle(request: HttpRequest): Response {
    const origin = request.header('origin')
    if (!origin) throw new HttpError(400, 'origin_required', 'Realtime authorization requires a browser Origin.')
    const context = this.execution.context
    const grant = this.broadcasting.issueConnectionTicket({
      actor: context.actor,
      initiator: context.initiator,
      delegation: context.delegation,
      authentication: context.authentication,
      ...(context.tenant ? { tenant: context.tenant } : {}),
      correlationId: context.correlationId,
      origin,
    })
    return Http.json(
      { ticket: grant.ticket, expiresAt: grant.expiresAt.toISOString() },
      200,
      { 'Cache-Control': 'no-store' },
    )
  }
}
`
    : ''
}

async function credentials(request: HttpRequest): Promise<{ identifier: string; contactEmail?: string; password: string }> {
  const body = await request.json<{ identifier?: unknown; contactEmail?: unknown; password?: unknown }>()
  if (typeof body.identifier !== 'string' || typeof body.password !== 'string') {
    throw new HttpError(422, 'validation_failed', 'identifier and password are required')
  }
  return {
    identifier: body.identifier,
    ...(typeof body.contactEmail === 'string' ? { contactEmail: body.contactEmail } : {}),
    password: body.password,
  }
}

function publicIdentity(identity: import('@doxajs/core').AuthIdentity) {
  return {
    id: identity.id,
    identifier: identity.identifier,
    identifierKind: identity.identifierKind,
    ...(identity.contactEmail ? { contactEmail: identity.contactEmail } : {}),
    verification: identity.verification,
  }
}

export class SendAuthEmail extends Action<{ kind: 'verification' | 'password-reset'; to: string; token: string }, void> {
  static id = 'send-auth-email'
  static override readonly access = 'public'
  private readonly mailer = this.inject(Mailer)
  async handle(input: { kind: 'verification' | 'password-reset'; to: string; token: string }): Promise<void> {
    await this.mailer.send({
      id: randomUUID(),
      from: ${JSON.stringify(`accounts@${applicationId}.test`)},
      to: [input.to],
      subject: input.kind === 'verification' ? 'Verify your email' : 'Reset your password',
      text: input.token,
    })
  }
}

export class RegisterRoute extends Route {
  static override readonly id = 'register'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/register'
  private readonly auth = this.inject(Auth)
  private readonly actions = this.inject(ActionBus)
  async handle(request: HttpRequest): Promise<Response> {
    const input = await credentials(request)
    const identity = await this.auth.register(input)
    if (identity.contactEmail && identity.verification === 'unverified') {
      const challenge = await this.auth.issueEmailVerification(identity.id)
      await this.actions.execute(SendAuthEmail, { kind: 'verification', to: identity.contactEmail, token: challenge.token.reveal() })
    }
    return Http.created({ identity: publicIdentity(identity) })
  }
}

export class LoginRoute extends Route {
  static override readonly id = 'login'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/login'
  private readonly auth = this.inject(Auth)
  async handle(request: HttpRequest): Promise<Response> {
    const grant = await this.auth.login(await credentials(request), { userAgent: request.header('user-agent') ?? 'unknown' })
    return Http.json(
      { identity: publicIdentity(grant.identity) },
      200,
      { 'set-cookie': this.auth.sessionCookie(grant) },
    )
  }
}

export class ReauthenticateRoute extends Route {
  static override readonly id = 'reauthenticate'
  static override readonly access = 'accounts.reauthenticate'
  readonly method = 'POST'
  readonly path = '/auth/reauthenticate'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest) {
    const authentication = this.execution.context.authentication
    const body = await request.json<{ password?: unknown }>()
    if (authentication.state !== 'authenticated' || authentication.method !== 'password' || !authentication.identityId || !authentication.sessionId) {
      throw new HttpError(403, 'password_session_required', 'A password-authenticated browser session is required.')
    }
    if (typeof body.password !== 'string') throw new HttpError(422, 'validation_failed', 'password is required')
    const authenticatedAt = await this.auth.reauthenticate(
      authentication.identityId,
      authentication.sessionId,
      body.password,
      { userAgent: request.header('user-agent') ?? 'unknown' },
    )
    return { authenticatedAt: authenticatedAt.toISOString() }
  }
}

export class MeRoute extends Route {
  static override readonly id = 'me'
  static override readonly access = 'accounts.view-self'
  readonly method = 'GET'
  readonly path = '/auth/me'
  private readonly execution = this.inject(CurrentExecution)
  handle(_request: HttpRequest) {
    return {
      actor: this.execution.context.actor,
      initiator: this.execution.context.initiator,
      delegation: this.execution.context.delegation,
      authentication: this.execution.context.authentication,
    }
  }
}

${
  configuration.impersonationEnabled
    ? `export class StartImpersonationRoute extends Route {
  static override readonly id = 'start-impersonation'
  static override readonly access = 'accounts.impersonate'
  readonly method = 'POST'
  readonly path = '/auth/impersonation'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest): Promise<Response> {
    const identityId = requirePasswordSession(this.execution)
    const sessionId = this.execution.context.authentication.sessionId!
    const body = await request.json<{ targetIdentityId?: unknown; reason?: unknown }>()
    if (typeof body.targetIdentityId !== 'string' || typeof body.reason !== 'string') {
      throw new HttpError(422, 'validation_failed', 'targetIdentityId and reason are required')
    }
    const grant = await this.auth.startImpersonation(
      identityId,
      sessionId,
      body.targetIdentityId,
      body.reason,
    )
    return Http.json(
      {
        impersonator: publicIdentity(grant.identity),
        target: publicIdentity(grant.target),
        expiresAt: grant.session.impersonation!.expiresAt.toISOString(),
      },
      200,
      { 'set-cookie': this.auth.sessionCookie(grant) },
    )
  }
}

export class StopImpersonationRoute extends Route {
  static override readonly id = 'stop-impersonation'
  static override readonly access = 'accounts.impersonation.stop'
  readonly method = 'DELETE'
  readonly path = '/auth/impersonation'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(_request: HttpRequest): Promise<Response> {
    const authentication = this.execution.context.authentication
    if (!authentication.identityId || !authentication.sessionId) {
      throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    }
    const grant = await this.auth.stopImpersonation(
      authentication.identityId,
      authentication.sessionId,
    )
    return Http.noContent({ 'set-cookie': this.auth.sessionCookie(grant) })
  }
}
`
    : ''
}

export class VerifyEmailRoute extends Route {
  static override readonly id = 'verify-email'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/email/verify'
  private readonly auth = this.inject(Auth)
  async handle(request: HttpRequest) {
    const body = await request.json<{ token?: unknown }>()
    if (typeof body.token !== 'string') throw new HttpError(422, 'validation_failed', 'token is required')
    const identity = await this.auth.verifyEmail(body.token)
    return { identity: publicIdentity(identity) }
  }
}

export class TokenRoute extends Route {
  static override readonly id = 'issue-token'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'POST'
  readonly path = '/auth/tokens'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest): Promise<Response> {
    const identityId = this.execution.context.authentication.identityId
    if (!identityId) throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    const body = await request.json<{ name?: unknown; constraints?: unknown }>()
    if (typeof body.name !== 'string' || (body.constraints !== undefined && (!Array.isArray(body.constraints) || !body.constraints.every((value) => typeof value === 'string')))) {
      throw new HttpError(422, 'validation_failed', 'name and string constraints are required')
    }
    const grant = await this.auth.issueAccessToken(identityId, {
      name: body.name,
      ...(body.constraints ? { constraints: body.constraints as string[] } : {}),
    })
    return Http.created({ accessToken: grant.accessToken, token: grant.token.reveal() })
  }
}

function requirePasswordSession(execution: CurrentExecution): string {
  const authentication = execution.context.authentication
  if (
    authentication.state !== 'authenticated' ||
    authentication.method !== 'password' ||
    !authentication.sessionId ||
    !authentication.identityId ||
    !isRecentPasswordAuthentication(authentication)
  ) {
    throw new HttpError(403, 'fresh_session_required', 'A recent password-authenticated browser session is required.')
  }
  return authentication.identityId
}

function publicAccessToken(token: import('@doxajs/core').AuthAccessToken) {
  return {
    id: token.id,
    name: token.name,
    displayPrefix: token.displayPrefix,
    constraints: token.constraints,
    createdAt: token.createdAt.toISOString(),
    expiresAt: token.expiresAt.toISOString(),
    ...(token.lastUsedAt ? { lastUsedAt: token.lastUsedAt.toISOString() } : {}),
    ...(token.revokedAt ? { revokedAt: token.revokedAt.toISOString() } : {}),
  }
}

export class LogoutRoute extends Route {
  static override readonly id = 'logout'
  static override readonly access = 'accounts.logout'
  readonly method = 'POST'
  readonly path = '/auth/logout'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(_request: HttpRequest): Promise<Response> {
    const sessionId = this.execution.context.authentication.sessionId
    if (!sessionId) throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    await this.auth.revokeSession(sessionId)
    return Http.noContent({ 'set-cookie': this.auth.expiredSessionCookie() })
  }
}

export class ListAccessTokensRoute extends Route {
  static override readonly id = 'list-access-tokens'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'GET'
  readonly path = '/auth/tokens'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(_request: HttpRequest) {
    const identityId = requirePasswordSession(this.execution)
    return { accessTokens: (await this.auth.listAccessTokens(identityId)).map(publicAccessToken) }
  }
}

export class RotateAccessTokenRoute extends Route {
  static override readonly id = 'rotate-access-token'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'POST'
  readonly path = '/auth/tokens/:id/rotate'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest) {
    const grant = await this.auth.rotateAccessToken(requirePasswordSession(this.execution), request.param('id'))
    return { accessToken: publicAccessToken(grant.accessToken), token: grant.token.reveal() }
  }
}

export class RevokeAccessTokenRoute extends Route {
  static override readonly id = 'revoke-access-token'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'DELETE'
  readonly path = '/auth/tokens/:id'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest): Promise<Response> {
    await this.auth.revokeAccessToken(requirePasswordSession(this.execution), request.param('id'))
    return Http.noContent()
  }
}

export class ChangePasswordRoute extends Route {
  static override readonly id = 'change-password'
  static override readonly access = 'accounts.password.change'
  readonly method = 'POST'
  readonly path = '/auth/password'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest): Promise<Response> {
    const identityId = requirePasswordSession(this.execution)
    const body = await request.json<{ currentPassword?: unknown; newPassword?: unknown }>()
    if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
      throw new HttpError(422, 'validation_failed', 'currentPassword and newPassword are required')
    }
    await this.auth.changePassword(identityId, body.currentPassword, body.newPassword)
    return Http.noContent({ 'set-cookie': this.auth.expiredSessionCookie() })
  }
}

export class ListSessionsRoute extends Route {
  static override readonly id = 'list-sessions'
  static override readonly access = 'accounts.sessions.manage'
  readonly method = 'GET'
  readonly path = '/auth/sessions'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(_request: HttpRequest) {
    const identityId = requirePasswordSession(this.execution)
    const sessions = await this.auth.listSessions(identityId)
    return { sessions: sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt?.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      revokedAt: session.revokedAt?.toISOString(),
      impersonation: session.impersonation ? {
        grantId: session.impersonation.grantId,
        targetIdentityId: session.impersonation.targetIdentityId,
        reason: session.impersonation.reason,
        startedAt: session.impersonation.startedAt.toISOString(),
        expiresAt: session.impersonation.expiresAt.toISOString(),
      } : undefined,
      current: session.id === this.execution.context.authentication.sessionId,
    })) }
  }
}

export class RevokeSessionRoute extends Route {
  static override readonly id = 'revoke-session'
  static override readonly access = 'accounts.sessions.manage'
  readonly method = 'DELETE'
  readonly path = '/auth/sessions/:id'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest): Promise<Response> {
    const identityId = requirePasswordSession(this.execution)
    const sessionId = request.param('id')
    const sessions = await this.auth.listSessions(identityId)
    if (sessions.some((session) => session.id === sessionId)) await this.auth.revokeSession(sessionId)
    return Http.noContent(
      sessionId === this.execution.context.authentication.sessionId
        ? { 'set-cookie': this.auth.expiredSessionCookie() }
        : undefined,
    )
  }
}

export class ResendVerificationRoute extends Route {
  static override readonly id = 'resend-verification'
  static override readonly access = 'accounts.email.verify'
  readonly method = 'POST'
  readonly path = '/auth/email/verification'
  private readonly auth = this.inject(Auth)
  private readonly actions = this.inject(ActionBus)
  private readonly execution = this.inject(CurrentExecution)
  async handle(_request: HttpRequest): Promise<Response> {
    const identityId = this.execution.context.authentication.identityId
    if (!identityId) throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    const identity = await this.auth.findIdentity(identityId)
    if (identity?.contactEmail && identity.verification === 'unverified') {
      const grant = await this.auth.issueEmailVerification(identity.id)
      await this.actions.execute(SendAuthEmail, { kind: 'verification', to: identity.contactEmail, token: grant.token.reveal() })
    }
    return Http.accepted(null)
  }
}

export class RequestPasswordResetRoute extends Route {
  static override readonly id = 'request-password-reset'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/password/reset/request'
  private readonly auth = this.inject(Auth)
  private readonly actions = this.inject(ActionBus)
  async handle(request: HttpRequest): Promise<Response> {
    const body = await request.json<{ identifier?: unknown }>()
    if (typeof body.identifier === 'string') {
      const challenge = await this.auth.issuePasswordReset(body.identifier)
      const identity = challenge ? await this.auth.findIdentity(challenge.identityId) : undefined
      if (challenge && identity?.contactEmail) await this.actions.execute(SendAuthEmail, { kind: 'password-reset', to: identity.contactEmail, token: challenge.token.reveal() })
    }
    return new Response(null, { status: 202 })
  }
}

export class ResetPasswordRoute extends Route {
  static override readonly id = 'reset-password'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/password/reset'
  private readonly auth = this.inject(Auth)
  async handle(request: HttpRequest): Promise<Response> {
    const body = await request.json<{ token?: unknown; password?: unknown }>()
    if (typeof body.token !== 'string' || typeof body.password !== 'string') {
      throw new HttpError(422, 'validation_failed', 'token and password are required')
    }
    await this.auth.resetPassword(body.token, body.password)
    return new Response(null, { status: 204 })
  }
}

export class AccountPolicy extends Policy {
  static override readonly id = 'account'
  static override readonly abilities = [
    'accounts.logout',
    'accounts.reauthenticate',
    'accounts.password.change',
    'accounts.email.verify',
    'accounts.sessions.manage',
    'accounts.tokens.manage',
    'accounts.view-self',
    'accounts.impersonation.stop',
  ]
  decide(request: PolicyRequest): PolicyDecision {
    if (request.actor.kind !== 'user' || request.context.authentication.state !== 'authenticated') {
      return deny('account', 'authentication_required')
    }
    if (
      request.ability === 'accounts.impersonation.stop' &&
      (!request.context.authentication.impersonationGrantId ||
        !request.context.delegation.some(
          (hop) => hop.grantId === request.context.authentication.impersonationGrantId,
        ))
    ) {
      return deny('account', 'impersonation_required')
    }
    if (
      ['accounts.tokens.manage', 'accounts.sessions.manage', 'accounts.password.change'].includes(request.ability) &&
      !isRecentPasswordAuthentication(request.context.authentication)
    ) {
      return deny('account', 'fresh_session_required')
    }
    return allow('account')
  }
}

export class DoxaCoreFeature extends Feature {
  id = 'doxa'
  configs = [${configs.join(', ')}]
  providers = [${providers.join(', ')}]
  actions = [${verificationRoutes || recoveryRoutes ? 'SendAuthEmail' : ''}]
  routes = [HealthRoute, ${configuration.broadcastingEnabled ? 'BroadcastAuthorizeRoute, ' : ''}${managedIdentity ? 'RegisterRoute, ' : ''}LoginRoute, LogoutRoute, ReauthenticateRoute, MeRoute, ${configuration.impersonationEnabled ? 'StartImpersonationRoute, StopImpersonationRoute, ' : ''}${verificationRoutes ? 'VerifyEmailRoute, ResendVerificationRoute, ' : ''}TokenRoute, ListAccessTokensRoute, RotateAccessTokenRoute, RevokeAccessTokenRoute, ${managedIdentity ? 'ChangePasswordRoute, ' : ''}ListSessionsRoute, RevokeSessionRoute${recoveryRoutes ? ', RequestPasswordResetRoute, ResetPasswordRoute' : ''}]
  policies = [AccountPolicy]
}
`
}

function requiredStringProperty(declaration: ts.ClassDeclaration, name: string): string {
  const property = classProperty(declaration, name)
  if (
    !property?.initializer ||
    !ts.isStringLiteral(property.initializer) ||
    !property.initializer.text
  ) {
    throw new DoxaCompilationError(`Application.${name} must be a non-empty string literal.`)
  }
  return property.initializer.text
}

function stringArrayProperty(declaration: ts.ClassDeclaration, name: string): readonly string[] {
  const property = classProperty(declaration, name)
  if (!property) return []
  const initializer = property.initializer
    ? unwrapLiteralExpression(property.initializer)
    : undefined
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
    throw new DoxaCompilationError(`Application.${name} must be a literal string array.`)
  }
  return initializer.elements.map((element) => {
    if (!ts.isStringLiteral(element)) {
      throw new DoxaCompilationError(`Application.${name} must contain string literals only.`)
    }
    return element.text
  })
}

function unwrapLiteralExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function objectProperty(
  declaration: ts.ClassDeclaration,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  const property = classProperty(declaration, name)
  if (!property) return undefined
  if (!property.initializer || !ts.isObjectLiteralExpression(property.initializer)) {
    throw new DoxaCompilationError(`Application.${name} must be an object literal.`)
  }
  return property.initializer
}

function classProperty(
  declaration: ts.ClassDeclaration,
  name: string,
): ts.PropertyDeclaration | undefined {
  return declaration.members.find(
    (member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === name,
  )
}

function nestedObject(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  const property = objectPropertyAssignment(object, name)
  if (!property) return undefined
  if (!ts.isObjectLiteralExpression(property.initializer)) {
    throw new DoxaCompilationError(`Application.framework.${name} must be an object literal.`)
  }
  return property.initializer
}

function identityVerificationMode(identity: ts.ObjectLiteralExpression | undefined): string {
  if (!identity) return 'mapped'
  const verification = nestedObject(identity, 'verification')
  if (!verification) return 'unsupported'
  const mode = requiredNestedString(verification, 'mode')
  if (mode !== 'mapped' && mode !== 'trusted' && mode !== 'unsupported') {
    throw new DoxaCompilationError('Auth verification mode must be mapped or trusted.')
  }
  return mode
}

function optionalString(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const property = objectPropertyAssignment(object, name)
  if (!property) return undefined
  if (!ts.isStringLiteral(property.initializer) || !property.initializer.text) {
    throw new DoxaCompilationError(`${name} must be a non-empty string literal.`)
  }
  return property.initializer.text
}

function requiredNestedString(object: ts.ObjectLiteralExpression, name: string): string {
  const value = optionalString(object, name)
  if (!value) throw new DoxaCompilationError(`${name} must be a non-empty string literal.`)
  return value
}

function hasObjectProperty(object: ts.ObjectLiteralExpression, name: string): boolean {
  return objectPropertyAssignment(object, name) !== undefined
}

function optionalBoolean(object: ts.ObjectLiteralExpression, name: string): boolean | undefined {
  const property = objectPropertyAssignment(object, name)
  if (!property) return undefined
  if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) return true
  if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) return false
  throw new DoxaCompilationError(`${name} must be a boolean literal.`)
}

function optionalStringArray(
  object: ts.ObjectLiteralExpression,
  name: string,
): readonly string[] | undefined {
  const property = objectPropertyAssignment(object, name)
  if (!property) return undefined
  if (!ts.isArrayLiteralExpression(property.initializer)) {
    throw new DoxaCompilationError(`${name} must be a literal string array.`)
  }
  return property.initializer.elements.map((element) => {
    if (!ts.isStringLiteral(element) || !element.text) {
      throw new DoxaCompilationError(`${name} must contain non-empty string literals only.`)
    }
    return element.text
  })
}

function optionalPositiveNumber(
  object: ts.ObjectLiteralExpression,
  name: string,
): number | undefined {
  const property = objectPropertyAssignment(object, name)
  if (!property) return undefined
  if (!ts.isNumericLiteral(property.initializer)) {
    throw new DoxaCompilationError(`${name} must be a positive number literal.`)
  }
  const value = Number(property.initializer.text)
  if (!Number.isFinite(value) || value <= 0) {
    throw new DoxaCompilationError(`${name} must be a positive number literal.`)
  }
  return value
}

function optionalPositiveInteger(
  object: ts.ObjectLiteralExpression,
  name: string,
): number | undefined {
  const value = optionalPositiveNumber(object, name)
  if (value !== undefined && !Number.isSafeInteger(value)) {
    throw new DoxaCompilationError(`${name} must be a positive safe integer literal.`)
  }
  return value
}

function optionalNonNegativeNumber(
  object: ts.ObjectLiteralExpression,
  name: string,
): number | undefined {
  const property = objectPropertyAssignment(object, name)
  if (!property) return undefined
  if (!ts.isNumericLiteral(property.initializer)) {
    throw new DoxaCompilationError(`${name} must be a non-negative number literal.`)
  }
  const value = Number(property.initializer.text)
  if (!Number.isFinite(value) || value < 0) {
    throw new DoxaCompilationError(`${name} must be a non-negative number literal.`)
  }
  return value
}

function optionalRate(object: ts.ObjectLiteralExpression, name: string): number | undefined {
  const property = objectPropertyAssignment(object, name)
  if (!property) return undefined
  if (!ts.isNumericLiteral(property.initializer)) {
    throw new DoxaCompilationError(`${name} must be a number literal between zero and one.`)
  }
  const value = Number(property.initializer.text)
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new DoxaCompilationError(`${name} must be a number literal between zero and one.`)
  }
  return value
}

function objectPropertyAssignment(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteral(property.name) && property.name.text === name)),
  )
}
