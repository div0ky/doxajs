import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

const KEY_HEADER = 'x-doxa-key'
const TIMESTAMP_HEADER = 'x-doxa-timestamp'
const NONCE_HEADER = 'x-doxa-nonce'
const SIGNATURE_HEADER = 'x-doxa-signature'

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
