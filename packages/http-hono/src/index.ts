import { once } from 'node:events'

import {
  AfterCommitError,
  AuthenticationError,
  AuthenticationRateLimitError,
  AuthorizationError,
  HttpError,
  httpFailure,
  httpSuccess,
  type HttpEngine,
  ModelNotFoundError,
  OptimisticConcurrencyError,
  type TraceContext,
} from '@doxajs/core'
import { type DoxaRuntime, ExecutionAdmissionError } from '@doxajs/runtime'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const DEFAULT_MAX_REQUEST_BODY_BYTES = 1024 * 1024

export interface HonoHttpEngineOptions {
  readonly maxRequestBodyBytes?: number
}

export class HonoHttpEngine implements HttpEngine {
  readonly #app = new Hono()
  readonly #maxRequestBodyBytes: number

  constructor(
    private readonly runtime: DoxaRuntime,
    options: HonoHttpEngineOptions = {},
  ) {
    const maximum = options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new TypeError('Hono maxRequestBodyBytes must be a positive safe integer.')
    }
    this.#maxRequestBodyBytes = maximum
    for (const route of runtime.manifest.routes) {
      this.#app.on(route.method, route.path, async (context) => {
        const startedAt = performance.now()
        let correlationId: string | undefined
        let responseTraceparent: string | undefined
        let authenticationHeaders: Readonly<Record<string, string>> | undefined
        try {
          const requestedCorrelation = correlationIdFrom(context.req.raw)
          correlationId = requestedCorrelation
          const resolved = await runtime.authenticateHttp(context.req.raw)
          authenticationHeaders = resolved.responseHeaders
          const trace = traceContextFrom(context.req.raw)
          const result = await runtime.admit(
            {
              actor: resolved.actor,
              ...(resolved.initiator ? { initiator: resolved.initiator } : {}),
              ...(resolved.delegation ? { delegation: resolved.delegation } : {}),
              authentication: resolved.authentication,
              ...(requestedCorrelation ? { correlationId: requestedCorrelation } : {}),
              ...(trace ? { trace } : {}),
              cancellation: context.req.raw.signal,
              transport: {
                kind: 'http',
                name: `${route.method} ${route.path}`,
              },
            },
            async (execution) => {
              correlationId = execution.correlationId
              responseTraceparent = formatTraceparent(execution.trace)
              const routeResult = await runtime.dispatchRoute(
                route.id,
                context.req.raw,
                context.req.param(),
              )
              const response = normalizeResponse(routeResult)
              runtime.logger
                .channel('http')
                .info(`${context.req.method} ${new URL(context.req.url).pathname}`, {
                  status: response.status,
                  durationMs: performance.now() - startedAt,
                })
              return response
            },
          )
          return withAuthenticationHeaders(
            withCorrelation(normalizeResponse(result), correlationId, responseTraceparent),
            authenticationHeaders,
          )
        } catch (error) {
          const response = withAuthenticationHeaders(
            withCorrelation(
              errorResponse(error, correlationId),
              correlationId,
              responseTraceparent,
            ),
            authenticationHeaders,
          )
          const attributes = {
            status: response.status,
            durationMs: performance.now() - startedAt,
            ...(correlationId ? { correlationId } : {}),
          }
          const message = `${context.req.method} ${new URL(context.req.url).pathname}`
          if (response.status >= 500)
            runtime.logger.channel('http').error(message, error, attributes)
          else runtime.logger.channel('http').warn(message, attributes)
          return response
        }
      })
    }

    this.#app.notFound((context) => {
      const path = new URL(context.req.url).pathname
      runtime.logger.channel('http').warn(`${context.req.method} ${path}`, { status: 404 })
      return errorDocument(
        404,
        'route_not_found',
        `No Doxa route matches ${context.req.method} ${path}.`,
      )
    })
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return await this.#app.fetch(await boundedRequest(request, this.#maxRequestBodyBytes))
    } catch (error) {
      return errorResponse(error)
    }
  }
}

export interface HonoHttpHostOptions {
  readonly port?: number
  readonly hostname?: string
  readonly maxRequestBodyBytes?: number
}

export type HttpHostState = 'ready' | 'draining' | 'stopped'

export class HonoHttpHost {
  #state: HttpHostState = 'ready'
  #shutdownPromise: Promise<void> | undefined
  readonly #server: ReturnType<typeof serve>

  private constructor(
    readonly engine: HonoHttpEngine,
    server: ReturnType<typeof serve>,
    private readonly runtime: DoxaRuntime,
  ) {
    this.#server = server
  }

  static async listen(
    runtime: DoxaRuntime,
    options: HonoHttpHostOptions = {},
  ): Promise<HonoHttpHost> {
    const engine = new HonoHttpEngine(runtime, {
      ...(options.maxRequestBodyBytes === undefined
        ? {}
        : { maxRequestBodyBytes: options.maxRequestBodyBytes }),
    })
    const server = serve({
      fetch: (request) => engine.fetch(request),
      port: options.port ?? 3000,
      ...(options.hostname ? { hostname: options.hostname } : {}),
    })
    if (!server.listening) await once(server, 'listening')
    return new HonoHttpHost(engine, server, runtime)
  }

  get state(): HttpHostState {
    return this.#state
  }

  get url(): URL {
    const address = this.#server.address()
    if (!address || typeof address === 'string') {
      throw new Error('The Doxa HTTP host does not have a TCP address.')
    }
    const hostname =
      address.address === '::'
        ? '127.0.0.1'
        : address.family === 'IPv6'
          ? `[${address.address}]`
          : address.address
    return new URL(`http://${hostname}:${address.port}`)
  }

  shutdown(): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise
    this.#shutdownPromise = this.#performShutdown()
    return this.#shutdownPromise
  }

  async #performShutdown(): Promise<void> {
    if (this.#state === 'stopped') return
    this.#state = 'draining'
    let closeError: unknown
    try {
      await new Promise<void>((resolve, reject) => {
        this.#server.close((error) => (error ? reject(error) : resolve()))
      })
    } catch (error) {
      closeError = error
    }
    try {
      await this.runtime.shutdown()
    } finally {
      this.#state = 'stopped'
    }
    if (closeError) throw closeError
  }
}

async function boundedRequest(request: Request, maximum: number): Promise<Request> {
  if (!request.body || request.method === 'GET' || request.method === 'HEAD') return request
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new HttpError(400, 'invalid_content_length', 'Content-Length must be a byte count.')
    }
    if (Number(contentLength) > maximum) throw payloadTooLarge(maximum)
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximum) {
        await reader.cancel().catch(() => undefined)
        throw payloadTooLarge(maximum)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  const headers = new Headers(request.headers)
  if (contentLength !== null) headers.set('content-length', String(size))
  return new Request(request, { body, headers })
}

function payloadTooLarge(maximum: number): HttpError {
  return new HttpError(
    413,
    'payload_too_large',
    `The request body exceeds the ${maximum}-byte limit.`,
  )
}

function correlationIdFrom(request: Request): string | undefined {
  const value = request.headers.get('x-correlation-id')
  if (!value) return undefined
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new HttpError(
      400,
      'invalid_correlation_id',
      'The X-Correlation-ID header contains unsupported characters or is too long.',
    )
  }
  return value
}

function traceContextFrom(request: Request): TraceContext | undefined {
  const value = request.headers.get('traceparent')
  if (!value) return undefined
  const match = value.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i)
  if (!match || /^0+$/.test(match[1]!) || /^0+$/.test(match[2]!)) {
    throw new HttpError(
      400,
      'invalid_traceparent',
      'The traceparent header is not a supported W3C trace context.',
    )
  }
  return {
    traceId: match[1]!.toLowerCase(),
    spanId: match[2]!.toLowerCase(),
    isRemote: true,
    traceFlags: Number.parseInt(match[3]!, 16),
  }
}

function formatTraceparent(trace: TraceContext): string | undefined {
  if (!trace.traceId || !trace.spanId) return undefined
  return `00-${trace.traceId}-${trace.spanId}-${(trace.traceFlags ?? 1).toString(16).padStart(2, '0')}`
}

function normalizeResponse(value: unknown): Response {
  if (value instanceof Response) return value
  if (value === undefined) return new Response(null, { status: 204 })
  return Response.json(httpSuccess(value))
}

function withCorrelation(
  response: Response,
  correlationId?: string,
  traceparent?: string,
): Response {
  const headers = new Headers(response.headers)
  if (correlationId && !headers.has('x-correlation-id'))
    headers.set('x-correlation-id', correlationId)
  if (traceparent && !headers.has('traceparent')) headers.set('traceparent', traceparent)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function withAuthenticationHeaders(
  response: Response,
  values?: Readonly<Record<string, string>>,
): Response {
  if (!values) return response
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(values)) {
    if (name.toLowerCase() === 'set-cookie') {
      const authenticationCookie = cookieName(value)
      if (
        authenticationCookie &&
        !headers.getSetCookie().some((existing) => cookieName(existing) === authenticationCookie)
      ) {
        headers.append(name, value)
      }
    } else if (!headers.has(name)) {
      headers.set(name, value)
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function cookieName(value: string): string | undefined {
  const separator = value.indexOf('=')
  if (separator <= 0) return undefined
  const name = value.slice(0, separator).trim()
  return name || undefined
}

function errorResponse(error: unknown, correlationId?: string): Response {
  if (error instanceof HttpError) {
    if (!Number.isInteger(error.status) || error.status < 400 || error.status > 599) {
      return withCorrelation(
        errorDocument(500, 'internal_error', 'The application could not complete the request.'),
        correlationId,
      )
    }
    return withCorrelation(
      errorDocument(error.status, error.code, error.message, error.details),
      correlationId,
    )
  }
  if (error instanceof AuthenticationError) {
    const status =
      error.code === 'invalid_credentials' || error.code === 'ambiguous_credentials' ? 401 : 422
    return withCorrelation(errorDocument(status, error.code, error.message), correlationId)
  }
  if (error instanceof AuthenticationRateLimitError) {
    return withCorrelation(
      errorDocument(429, 'rate_limited', error.message, undefined, {
        'retry-after': String(error.retryAfterSeconds),
      }),
      correlationId,
    )
  }
  if (error instanceof AuthorizationError) {
    const status = error.decision.code === 'authentication_required' ? 401 : 403
    return withCorrelation(
      errorDocument(
        status,
        status === 401 ? 'authentication_required' : 'forbidden',
        status === 401 ? 'Authentication is required.' : 'The current actor is not authorized.',
      ),
      correlationId,
    )
  }
  if (error instanceof ModelNotFoundError) {
    return withCorrelation(errorDocument(404, 'model_not_found', error.message), correlationId)
  }
  if (error instanceof OptimisticConcurrencyError) {
    return withCorrelation(
      errorDocument(409, 'optimistic_concurrency_conflict', error.message),
      correlationId,
    )
  }
  if (error instanceof AfterCommitError) {
    return withCorrelation(
      errorDocument(
        500,
        'after_commit_failed',
        'The action committed, but after-commit processing did not complete successfully.',
      ),
      correlationId,
    )
  }
  if (error instanceof ExecutionAdmissionError) {
    return withCorrelation(
      errorDocument(503, 'service_unavailable', 'The application is not accepting HTTP work.'),
      correlationId,
    )
  }
  return withCorrelation(
    errorDocument(500, 'internal_error', 'The application could not complete the request.'),
    correlationId,
  )
}

function errorDocument(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  headers?: Headers | Record<string, string> | Array<[string, string]>,
): Response {
  return Response.json(httpFailure(code, message, jsonSafeDetails(details)), {
    status,
    ...(headers ? { headers } : {}),
  })
}

function jsonSafeDetails(details: unknown): unknown {
  if (details === undefined) return undefined
  try {
    const serialized = JSON.stringify(details)
    return serialized === undefined ? undefined : JSON.parse(serialized)
  } catch {
    // Error mapping is the final HTTP safety boundary. Invalid optional diagnostics must not
    // escape the canonical envelope or expose the private HTTP engine's failure behavior.
    return undefined
  }
}
