import type {
  ActorRef,
  AuthenticationContext,
  ExecutionContext,
  PolicyDecision,
  SecretString,
} from './index.js'
import { Instant } from './graphite.js'

export interface AuthIdentity {
  readonly id: string
  readonly identifier: string
  readonly identifierKind: 'email' | 'username' | 'custom'
  readonly contactEmail?: string
  readonly verification: 'verified' | 'unverified' | 'unsupported'
  readonly createdAt: Instant
}

export interface AuthSession {
  readonly id: string
  readonly identityId: string
  readonly createdAt: Instant
  readonly authenticatedAt: Instant
  readonly expiresAt: Instant
  readonly lastSeenAt?: Instant
  readonly revokedAt?: Instant
}

export interface AuthSessionGrant {
  readonly identity: AuthIdentity
  readonly session: AuthSession
  readonly token: SecretString
}

export interface AuthAccessToken {
  readonly id: string
  readonly identityId: string
  readonly name: string
  readonly displayPrefix: string
  readonly constraints: readonly string[]
  readonly createdAt: Instant
  readonly expiresAt: Instant
  readonly lastUsedAt?: Instant
  readonly revokedAt?: Instant
}

export interface AuthAccessTokenGrant {
  readonly accessToken: AuthAccessToken
  readonly token: SecretString
}

export interface IssueAccessTokenInput {
  readonly name: string
  readonly constraints?: readonly string[]
  readonly expiresAt?: Instant
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
  readonly expiresAt: Instant
}

export interface AuthRequestMetadata {
  readonly ipAddress?: string
  readonly userAgent?: string
}

export interface ResolvedHttpAuthentication {
  readonly actor: ActorRef
  readonly authentication: AuthenticationContext
  readonly responseHeaders?: Readonly<Record<string, string>>
}

export function isRecentPasswordAuthentication(
  authentication: AuthenticationContext,
  maxAgeSeconds = 15 * 60,
  now = Instant.now(),
): boolean {
  const authenticatedAt = authentication.authenticatedAt
  const maxAgeMicroseconds = maxAgeSeconds * 1_000_000
  const ageMicroseconds =
    authenticatedAt instanceof Instant
      ? now.epochMicroseconds - authenticatedAt.epochMicroseconds
      : -1n
  return (
    Number.isSafeInteger(maxAgeMicroseconds) &&
    maxAgeMicroseconds >= 0 &&
    authentication.state === 'authenticated' &&
    authentication.method === 'password' &&
    Boolean(authentication.sessionId && authentication.identityId) &&
    ageMicroseconds >= 0n &&
    ageMicroseconds <= BigInt(maxAgeMicroseconds)
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
      | 'compromised_password',
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
  ): Promise<Instant>
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
