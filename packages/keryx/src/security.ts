import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'

import type { ActorRef, AuthenticationContext, DelegationHop, TenantRef } from '@doxajs/core'

const KEY_HEADER = 'x-doxa-key'
const TIMESTAMP_HEADER = 'x-doxa-timestamp'
const NONCE_HEADER = 'x-doxa-nonce'
const SIGNATURE_HEADER = 'x-doxa-signature'
const ADMISSION_TICKET_VERSION = 1
const ADMISSION_TICKET_PREFIX = 'v1'
const ADMISSION_TICKET_IV_BYTES = 12
const ADMISSION_TICKET_TAG_BYTES = 16

export interface KeryxConnectionTicketInput {
  readonly actor: ActorRef
  readonly initiator?: ActorRef
  readonly delegation?: readonly DelegationHop[]
  readonly authentication: AuthenticationContext
  readonly tenant?: TenantRef
  readonly correlationId: string
  readonly origin: string
}

export interface KeryxConnectionTicketGrant {
  readonly ticket: string
  readonly expiresAt: Date
}

export interface KeryxConnectionTicketAdmission {
  readonly ticketId: string
  readonly actor: ActorRef
  readonly initiator?: ActorRef
  readonly delegation?: readonly DelegationHop[]
  readonly authentication: AuthenticationContext
  readonly tenant?: TenantRef
  readonly correlationId: string
  readonly expiresAt: number
}

interface AdmissionTicketPayload {
  readonly version: 1
  readonly applicationId: string
  readonly ticketId: string
  readonly issuedAt: number
  readonly expiresAt: number
  readonly origin: string
  readonly actor: ActorRef
  readonly initiator?: ActorRef
  readonly delegation?: readonly Readonly<
    Omit<DelegationHop, 'expiresAt'> & { readonly expiresAt?: string }
  >[]
  readonly authentication: Readonly<
    Omit<AuthenticationContext, 'authenticatedAt'> & { readonly authenticatedAt?: string }
  >
  readonly tenant?: TenantRef
  readonly correlationId: string
}

export interface KeryxPublishCredentials {
  readonly key: string
  readonly secret: string
}

export class KeryxAuthenticationError extends Error {
  constructor(
    readonly code: string,
    readonly status: 401 | 409,
    message: string,
  ) {
    super(message)
    this.name = 'KeryxAuthenticationError'
  }
}

export class KeryxPublishAuthenticator {
  readonly #nonces = new Map<string, number>()

  constructor(
    private readonly credentials: KeryxPublishCredentials,
    private readonly clockSkewSeconds = 60,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!credentials.key) throw new TypeError('Keryx publish key is required.')
    if (credentials.secret.length < 32)
      throw new TypeError('Keryx publish secret must contain at least 32 characters.')
  }

  headers(method: string, path: string, body: string): Readonly<Record<string, string>> {
    const timestamp = Math.floor(this.now() / 1000).toString()
    const nonce = randomUUID()
    return Object.freeze({
      'X-Doxa-Key': this.credentials.key,
      'X-Doxa-Timestamp': timestamp,
      'X-Doxa-Nonce': nonce,
      'X-Doxa-Signature': signature(this.credentials.secret, method, path, timestamp, nonce, body),
    })
  }

  verify(request: Request, body: string): void {
    const key = request.headers.get(KEY_HEADER)
    const timestamp = request.headers.get(TIMESTAMP_HEADER)
    const nonce = request.headers.get(NONCE_HEADER)
    const provided = request.headers.get(SIGNATURE_HEADER)
    if (!key || !timestamp || !nonce || !provided)
      throw new KeryxAuthenticationError(
        'publish_authentication_required',
        401,
        'Keryx publish authentication is required.',
      )
    if (!safeEqual(key, this.credentials.key))
      throw new KeryxAuthenticationError(
        'publish_key_invalid',
        401,
        'Keryx publish credentials are invalid.',
      )
    const timestampSeconds = Number(timestamp)
    const nowSeconds = Math.floor(this.now() / 1000)
    if (
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(nowSeconds - timestampSeconds) > this.clockSkewSeconds
    )
      throw new KeryxAuthenticationError(
        'publish_timestamp_invalid',
        401,
        'Keryx publish timestamp is outside the accepted window.',
      )
    this.#pruneNonces(nowSeconds)
    if (this.#nonces.has(nonce))
      throw new KeryxAuthenticationError(
        'publish_replay_detected',
        409,
        'Keryx rejected a replayed publish request.',
      )
    const expected = signature(
      this.credentials.secret,
      request.method,
      new URL(request.url).pathname,
      timestamp,
      nonce,
      body,
    )
    if (!safeEqual(provided, expected))
      throw new KeryxAuthenticationError(
        'publish_signature_invalid',
        401,
        'Keryx publish credentials are invalid.',
      )
    this.#nonces.set(nonce, timestampSeconds + this.clockSkewSeconds)
  }

  #pruneNonces(nowSeconds: number): void {
    for (const [nonce, expiresAt] of this.#nonces)
      if (expiresAt < nowSeconds) this.#nonces.delete(nonce)
  }
}

export class KeryxAdmissionTickets {
  readonly #key: Buffer

  constructor(
    private readonly applicationId: string,
    secret: string,
    private readonly lifetimeMilliseconds: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!applicationId) throw new TypeError('Keryx application id is required.')
    if (secret.length < 32)
      throw new TypeError('Keryx admission secret must contain at least 32 characters.')
    if (!Number.isSafeInteger(lifetimeMilliseconds) || lifetimeMilliseconds <= 0)
      throw new TypeError('Keryx admission ticket lifetime must be a positive integer.')
    this.#key = createHash('sha256').update('doxa:keryx:admission:').update(secret).digest()
  }

  issue(input: KeryxConnectionTicketInput): KeryxConnectionTicketGrant {
    const issuedAt = this.now()
    const delegationExpiry = input.delegation
      ?.flatMap((hop) => (hop.expiresAt ? [hop.expiresAt.getTime()] : []))
      .sort((left, right) => left - right)[0]
    const expiresAt = Math.min(
      issuedAt + this.lifetimeMilliseconds,
      delegationExpiry ?? Number.POSITIVE_INFINITY,
    )
    if (expiresAt <= issuedAt)
      throw new TypeError('Keryx cannot issue a ticket for expired delegation.')
    const payload: AdmissionTicketPayload = {
      version: ADMISSION_TICKET_VERSION,
      applicationId: this.applicationId,
      ticketId: randomUUID(),
      issuedAt,
      expiresAt,
      origin: normalizeBrowserOrigin(input.origin),
      actor: parseTicketActor(input.actor),
      ...(input.initiator ? { initiator: parseTicketActor(input.initiator) } : {}),
      ...(input.delegation ? { delegation: serializeTicketDelegation(input.delegation) } : {}),
      authentication: serializeTicketAuthentication(input.authentication),
      ...(input.tenant ? { tenant: parseTicketTenant(input.tenant) } : {}),
      correlationId: nonEmptyString(input.correlationId, 'correlation id'),
    }
    const initializationVector = randomBytes(ADMISSION_TICKET_IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', this.#key, initializationVector)
    cipher.setAAD(this.#additionalAuthenticatedData())
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag()
    return Object.freeze({
      ticket: [
        ADMISSION_TICKET_PREFIX,
        initializationVector.toString('base64url'),
        encrypted.toString('base64url'),
        tag.toString('base64url'),
      ].join('.'),
      expiresAt: new Date(expiresAt),
    })
  }

  open(ticket: string, origin: string): KeryxConnectionTicketAdmission {
    if (ticket.length === 0 || ticket.length > 8_192)
      throw new KeryxAuthenticationError(
        'admission_ticket_invalid',
        401,
        'Keryx admission credentials are invalid.',
      )
    const [version, encodedInitializationVector, encodedPayload, encodedTag, extra] =
      ticket.split('.')
    if (
      version !== ADMISSION_TICKET_PREFIX ||
      !encodedInitializationVector ||
      !encodedPayload ||
      !encodedTag ||
      extra !== undefined
    )
      throw this.#invalidTicket()
    try {
      const initializationVector = Buffer.from(encodedInitializationVector, 'base64url')
      const encrypted = Buffer.from(encodedPayload, 'base64url')
      const tag = Buffer.from(encodedTag, 'base64url')
      if (
        initializationVector.length !== ADMISSION_TICKET_IV_BYTES ||
        encrypted.length === 0 ||
        tag.length !== ADMISSION_TICKET_TAG_BYTES
      )
        throw this.#invalidTicket()
      const decipher = createDecipheriv('aes-256-gcm', this.#key, initializationVector)
      decipher.setAAD(this.#additionalAuthenticatedData())
      decipher.setAuthTag(tag)
      const decoded = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
      return this.#parsePayload(JSON.parse(decoded), origin)
    } catch (error) {
      if (error instanceof KeryxAuthenticationError) throw error
      throw this.#invalidTicket()
    }
  }

  #parsePayload(value: unknown, origin: string): KeryxConnectionTicketAdmission {
    if (!isRecord(value)) throw this.#invalidTicket()
    const now = this.now()
    if (
      value.version !== ADMISSION_TICKET_VERSION ||
      value.applicationId !== this.applicationId ||
      typeof value.issuedAt !== 'number' ||
      !Number.isSafeInteger(value.issuedAt) ||
      typeof value.expiresAt !== 'number' ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.issuedAt > now + 5_000 ||
      value.expiresAt <= now ||
      value.expiresAt <= value.issuedAt ||
      value.expiresAt - value.issuedAt > this.lifetimeMilliseconds ||
      value.origin !== normalizeBrowserOrigin(origin)
    )
      throw this.#invalidTicket()
    return Object.freeze({
      ticketId: nonEmptyString(value.ticketId, 'ticket id'),
      actor: parseTicketActor(value.actor),
      ...(value.initiator === undefined ? {} : { initiator: parseTicketActor(value.initiator) }),
      ...(value.delegation === undefined
        ? {}
        : { delegation: parseTicketDelegation(value.delegation) }),
      authentication: parseTicketAuthentication(value.authentication),
      ...(value.tenant === undefined ? {} : { tenant: parseTicketTenant(value.tenant) }),
      correlationId: nonEmptyString(value.correlationId, 'correlation id'),
      expiresAt: value.expiresAt,
    })
  }

  #additionalAuthenticatedData(): Buffer {
    return Buffer.from(`doxa:keryx:admission:v1:${this.applicationId}`)
  }

  #invalidTicket(): KeryxAuthenticationError {
    return new KeryxAuthenticationError(
      'admission_ticket_invalid',
      401,
      'Keryx admission credentials are invalid.',
    )
  }
}

function signature(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  const digest = createHash('sha256').update(body).digest('hex')
  const canonical = [method.toUpperCase(), path, timestamp, nonce, digest].join('\n')
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function normalizeBrowserOrigin(value: string): string {
  let origin: URL
  try {
    origin = new URL(value)
  } catch {
    throw new TypeError('Keryx admission tickets require a valid browser origin.')
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.origin !== value ||
    origin.username ||
    origin.password
  )
    throw new TypeError('Keryx admission tickets require an exact HTTP browser origin.')
  return origin.origin
}

function serializeTicketAuthentication(
  authentication: AuthenticationContext,
): AdmissionTicketPayload['authentication'] {
  return Object.freeze({
    state: authentication.state,
    ...(authentication.identityId ? { identityId: authentication.identityId } : {}),
    ...(authentication.method ? { method: authentication.method } : {}),
    ...(authentication.assurance ? { assurance: authentication.assurance } : {}),
    ...(authentication.authenticatedAt
      ? { authenticatedAt: authentication.authenticatedAt.toISOString() }
      : {}),
    ...(authentication.sessionId ? { sessionId: authentication.sessionId } : {}),
    ...(authentication.impersonationGrantId
      ? { impersonationGrantId: authentication.impersonationGrantId }
      : {}),
    ...(authentication.credentialId ? { credentialId: authentication.credentialId } : {}),
    ...(authentication.constraints
      ? { constraints: Object.freeze([...authentication.constraints]) }
      : {}),
  })
}

function serializeTicketDelegation(
  delegation: readonly DelegationHop[],
): NonNullable<AdmissionTicketPayload['delegation']> {
  if (delegation.length > 16) throw new TypeError('Keryx admission ticket delegation is invalid.')
  return Object.freeze(
    delegation.map((hop) =>
      Object.freeze({
        from: parseTicketActor(hop.from),
        to: parseTicketActor(hop.to),
        grantId: nonEmptyString(hop.grantId, 'delegation grant id'),
        reason: nonEmptyString(hop.reason, 'delegation reason'),
        ...(hop.expiresAt ? { expiresAt: hop.expiresAt.toISOString() } : {}),
      }),
    ),
  )
}

function parseTicketDelegation(value: unknown): readonly DelegationHop[] {
  if (!Array.isArray(value) || value.length > 16)
    throw new TypeError('Keryx admission ticket delegation is invalid.')
  return Object.freeze(
    value.map((entry) => {
      if (!isRecord(entry)) throw new TypeError('Keryx admission ticket delegation is invalid.')
      let expiresAt: Date | undefined
      if (entry.expiresAt !== undefined) {
        if (typeof entry.expiresAt !== 'string')
          throw new TypeError('Keryx admission ticket delegation is invalid.')
        expiresAt = new Date(entry.expiresAt)
        if (!Number.isFinite(expiresAt.getTime()))
          throw new TypeError('Keryx admission ticket delegation is invalid.')
      }
      return Object.freeze({
        from: parseTicketActor(entry.from),
        to: parseTicketActor(entry.to),
        grantId: nonEmptyString(entry.grantId, 'delegation grant id'),
        reason: nonEmptyString(entry.reason, 'delegation reason'),
        ...(expiresAt ? { expiresAt } : {}),
      })
    }),
  )
}

function parseTicketActor(value: unknown): ActorRef {
  if (
    !isRecord(value) ||
    !['anonymous', 'user', 'service', 'system'].includes(String(value.kind)) ||
    (value.id !== undefined && typeof value.id !== 'string')
  )
    throw new TypeError('Keryx admission ticket actor is invalid.')
  return Object.freeze({
    kind: value.kind as ActorRef['kind'],
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
  })
}

function parseTicketAuthentication(value: unknown): AuthenticationContext {
  if (
    !isRecord(value) ||
    !['anonymous', 'authenticated'].includes(String(value.state)) ||
    !optionalString(value.identityId) ||
    !optionalString(value.method) ||
    !optionalString(value.sessionId) ||
    !optionalString(value.impersonationGrantId) ||
    !optionalString(value.credentialId) ||
    (value.assurance !== undefined &&
      !['single-factor', 'multi-factor', 'phishing-resistant'].includes(String(value.assurance))) ||
    (value.constraints !== undefined &&
      (!Array.isArray(value.constraints) ||
        !value.constraints.every((constraint) => typeof constraint === 'string')))
  )
    throw new TypeError('Keryx admission ticket authentication is invalid.')
  let authenticatedAt: Date | undefined
  if (value.authenticatedAt !== undefined) {
    if (typeof value.authenticatedAt !== 'string') {
      throw new TypeError('Keryx admission ticket authentication is invalid.')
    }
    authenticatedAt = new Date(value.authenticatedAt)
    if (!Number.isFinite(authenticatedAt.getTime())) {
      throw new TypeError('Keryx admission ticket authentication is invalid.')
    }
  }
  return Object.freeze({
    state: value.state as AuthenticationContext['state'],
    ...(typeof value.identityId === 'string' ? { identityId: value.identityId } : {}),
    ...(typeof value.method === 'string' ? { method: value.method } : {}),
    ...(value.assurance
      ? { assurance: value.assurance as NonNullable<AuthenticationContext['assurance']> }
      : {}),
    ...(authenticatedAt ? { authenticatedAt } : {}),
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    ...(typeof value.impersonationGrantId === 'string'
      ? { impersonationGrantId: value.impersonationGrantId }
      : {}),
    ...(typeof value.credentialId === 'string' ? { credentialId: value.credentialId } : {}),
    ...(Array.isArray(value.constraints)
      ? { constraints: Object.freeze([...value.constraints] as string[]) }
      : {}),
  })
}

function parseTicketTenant(value: unknown): TenantRef {
  if (!isRecord(value)) throw new TypeError('Keryx admission ticket tenant is invalid.')
  return Object.freeze({ id: nonEmptyString(value.id, 'tenant id') })
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512)
    throw new TypeError(`Keryx admission ticket ${name} is invalid.`)
  return value
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
