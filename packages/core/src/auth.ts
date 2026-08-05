import type {
  ActorRef,
  AuthenticationContext,
  ExecutionContext,
  PolicyDecision,
  SecretString,
} from './index.js'

export interface AuthIdentity {
  readonly id: string
  readonly identifier: string
  readonly identifierKind: 'email' | 'username' | 'custom'
  readonly contactEmail?: string
  readonly verification: 'verified' | 'unverified' | 'unsupported'
  readonly createdAt: Date
}

export interface AuthSession {
  readonly id: string
  readonly identityId: string
  readonly createdAt: Date
  readonly authenticatedAt: Date
  readonly expiresAt: Date
  readonly lastSeenAt?: Date
  readonly revokedAt?: Date
  readonly impersonation?: AuthImpersonation
}

export interface AuthImpersonation {
  readonly targetIdentityId: string
  readonly reason: string
  readonly startedAt: Date
  readonly expiresAt: Date
}

export interface AuthSessionGrant {
  readonly identity: AuthIdentity
  readonly session: AuthSession
  readonly token: SecretString
}

export interface AuthImpersonationGrant extends AuthSessionGrant {
  readonly target: AuthIdentity
}

export interface AuthAccessToken {
  readonly id: string
  readonly identityId: string
  readonly name: string
  readonly displayPrefix: string
  readonly constraints: readonly string[]
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly lastUsedAt?: Date
  readonly revokedAt?: Date
}

export interface AuthAccessTokenGrant {
  readonly accessToken: AuthAccessToken
  readonly token: SecretString
}

export interface IssueAccessTokenInput {
  readonly name: string
  readonly constraints?: readonly string[]
  readonly expiresAt?: Date
}

export interface RegistrationInput {
  readonly identifier: string
  readonly contactEmail?: string
  readonly password: string
}

export interface LoginInput {
  readonly identifier: string
  readonly password: string
}

export interface AuthIdentityRegistrationInput {
  readonly identifier: string
  readonly contactEmail?: string
}

/** Supplies non-auth model attributes for managed external-identity registration. */
export interface AuthIdentityRegistrationFactory {
  defaults(
    input: AuthIdentityRegistrationInput,
  ): Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>
}

export interface AuthChallengeGrant {
  readonly identityId: string
  readonly token: SecretString
  readonly expiresAt: Date
}

export interface AuthRequestMetadata {
  readonly ipAddress?: string
  readonly userAgent?: string
}

export interface ResolvedHttpAuthentication {
  readonly actor: ActorRef
  readonly initiator?: ActorRef
  readonly delegation?: ExecutionContext['delegation']
  readonly authentication: AuthenticationContext
  readonly responseHeaders?: Readonly<Record<string, string>>
}

export function isRecentPasswordAuthentication(
  authentication: AuthenticationContext,
  maxAgeSeconds = 15 * 60,
  now = new Date(),
): boolean {
  const authenticatedAt = authentication.authenticatedAt
  const ageMilliseconds =
    authenticatedAt instanceof Date ? now.getTime() - authenticatedAt.getTime() : Number.NaN
  return (
    Number.isFinite(maxAgeSeconds) &&
    maxAgeSeconds >= 0 &&
    authentication.state === 'authenticated' &&
    authentication.method === 'password' &&
    Boolean(authentication.sessionId && authentication.identityId) &&
    ageMilliseconds >= 0 &&
    ageMilliseconds <= maxAgeSeconds * 1_000
  )
}

export interface AuthStorageDescription {
  readonly kind: 'doxa-owned' | 'mapped' | 'custom'
  readonly mapping?: {
    readonly mode: 'doxa-owned' | 'managed' | 'login-only'
    readonly source: 'doxa-owned' | 'model' | 'table'
    readonly modelId?: string
    readonly identifier: {
      readonly field: string
      readonly kind: 'email' | 'username' | 'custom'
      readonly normalization: string
    }
    readonly contactEmail?: string
    readonly verification: 'mapped' | 'trusted' | 'unsupported'
    readonly eligibility: readonly string[]
    readonly hashers: readonly string[]
    readonly credentialUpgrade: 'never' | 'in-place'
    readonly securityWarnings: readonly string[]
  }
  readonly identities?: { readonly table: string; readonly ownership: 'doxa' | 'external' }
  readonly passwords?: { readonly table: string; readonly ownership: 'doxa' | 'external' }
  readonly sessions?: { readonly table: string; readonly ownership: 'doxa' | 'external' }
  readonly accessTokens?: { readonly table: string; readonly ownership: 'doxa' | 'external' }
  readonly challenges?: { readonly table: string; readonly ownership: 'doxa' | 'external' }
  readonly audit?: { readonly table: string; readonly ownership: 'doxa' | 'external' }
}

export class AuthenticationError extends Error {
  override readonly name = 'AuthenticationError'

  constructor(
    readonly code:
      | 'ambiguous_credentials'
      | 'invalid_credentials'
      | 'email_taken'
      | 'invalid_registration'
      | 'invalid_token'
      | 'compromised_password'
      | 'impersonation_not_allowed'
      | 'impersonation_not_active',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export class AuthenticationRateLimitError extends Error {
  override readonly name = 'AuthenticationRateLimitError'
  constructor(readonly retryAfterSeconds: number) {
    super('Too many authentication attempts. Try again later.')
  }
}

/** Doxa-owned identity and browser-session boundary. */
export abstract class Auth {
  storage(): AuthStorageDescription {
    return { kind: 'custom' }
  }
  abstract register(input: RegistrationInput): Promise<AuthIdentity>
  abstract findIdentity(identityId: string): Promise<AuthIdentity | undefined>
  abstract login(input: LoginInput, metadata?: AuthRequestMetadata): Promise<AuthSessionGrant>
  abstract issueEmailVerification(identityId: string): Promise<AuthChallengeGrant>
  abstract verifyEmail(token: string): Promise<AuthIdentity>
  abstract issuePasswordReset(
    identifier: string,
    metadata?: AuthRequestMetadata,
  ): Promise<AuthChallengeGrant | undefined>
  abstract resetPassword(token: string, newPassword: string): Promise<void>
  abstract changePassword(
    identityId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void>
  abstract reauthenticate(
    identityId: string,
    sessionId: string,
    password: string,
    metadata?: AuthRequestMetadata,
  ): Promise<Date>
  async startImpersonation(
    identityId: string,
    sessionId: string,
    targetIdentityId: string,
    reason: string,
  ): Promise<AuthImpersonationGrant> {
    void identityId
    void sessionId
    void targetIdentityId
    void reason
    throw new AuthenticationError(
      'impersonation_not_allowed',
      'This authentication provider does not support impersonation.',
    )
  }
  async stopImpersonation(identityId: string, sessionId: string): Promise<AuthSessionGrant> {
    void identityId
    void sessionId
    throw new AuthenticationError(
      'impersonation_not_active',
      'This authentication provider does not support impersonation.',
    )
  }
  async validateAuthentication(
    actor: ActorRef,
    authentication: AuthenticationContext,
  ): Promise<boolean> {
    return authentication.state === 'anonymous'
      ? actor.kind === 'anonymous'
      : actor.kind === 'user' && actor.id === authentication.identityId
  }
  abstract revokeSession(sessionId: string): Promise<void>
  abstract listSessions(identityId: string): Promise<readonly AuthSession[]>
  abstract revokeAllSessions(identityId: string): Promise<number>
  abstract issueAccessToken(
    identityId: string,
    input: IssueAccessTokenInput,
  ): Promise<AuthAccessTokenGrant>
  abstract listAccessTokens(identityId: string): Promise<readonly AuthAccessToken[]>
  abstract rotateAccessToken(identityId: string, tokenId: string): Promise<AuthAccessTokenGrant>
  abstract revokeAccessToken(identityId: string, tokenId: string): Promise<void>
  abstract recordAuthorization(
    ability: string,
    decision: PolicyDecision,
    context: ExecutionContext,
  ): Promise<void>
  abstract resolveHttp(request: Request): Promise<ResolvedHttpAuthentication>
  abstract sessionCookie(grant: AuthSessionGrant): string
  abstract expiredSessionCookie(): string
}
