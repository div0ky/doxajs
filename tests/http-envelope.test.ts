import { Http, HttpError, httpFailure, httpSuccess, Logger, type HttpEnvelope } from '@doxajs/core'
import { HonoHttpEngine } from '@doxajs/http-hono'
import type { DoxaRuntime } from '@doxajs/runtime'
import { describe, expect, expectTypeOf, it } from 'vitest'

describe('Doxa HTTP response envelopes', () => {
  it('uses one discriminated union for success and failure', () => {
    const success = httpSuccess({ id: 'user-1' })
    const failure = httpFailure('validation_failed', 'The request did not pass validation.', {
      issues: [{ path: ['email'], message: 'Invalid email' }],
    })

    expect(success).toEqual({ ok: true, data: { id: 'user-1' } })
    expect(failure).toEqual({
      ok: false,
      code: 'validation_failed',
      message: 'The request did not pass validation.',
      data: null,
      details: { issues: [{ path: ['email'], message: 'Invalid email' }] },
    })
    expectTypeOf(success).toMatchTypeOf<HttpEnvelope<{ id: string }>>()
    expectTypeOf(failure).toMatchTypeOf<HttpEnvelope<never>>()
  })

  it('keeps status helpers enveloped and no-content bodyless', async () => {
    const created = Http.created({ id: 'user-1' })
    const accepted = Http.accepted(null)
    const noContent = Http.noContent()

    expect(created.status).toBe(201)
    expect(await created.json()).toEqual({ ok: true, data: { id: 'user-1' } })
    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toEqual({ ok: true, data: null })
    expect(noContent.status).toBe(204)
    expect(await noContent.text()).toBe('')
  })

  it('automatically wraps plain route payloads and every adapter failure', async () => {
    const runtime = {
      manifest: {
        routes: [
          { id: 'route:test/payload', method: 'GET', path: '/payload' },
          { id: 'route:test/failure', method: 'GET', path: '/failure' },
          { id: 'route:test/unsafe-details', method: 'GET', path: '/unsafe-details' },
        ],
      },
      logger: new Logger(),
      authenticateHttp: () =>
        Promise.resolve({
          actor: { kind: 'anonymous' },
          authentication: { state: 'anonymous' },
        }),
      admit: async (_seed: unknown, work: (context: object) => Promise<unknown>) =>
        work({
          correlationId: 'envelope-test',
          trace: { traceId: '1'.repeat(32), spanId: '2'.repeat(16), traceFlags: 1 },
        }),
      dispatchRoute: (id: string) => {
        if (id === 'route:test/unsafe-details') {
          throw new HttpError(400, 'invalid_details', 'The request failed.', { unsafe: 1n })
        }
        if (id === 'route:test/failure') {
          throw new HttpError(409, 'conflict', 'The resource changed.', { version: 2 })
        }
        return { id: 'payload-1' }
      },
    } as unknown as DoxaRuntime
    const http = new HonoHttpEngine(runtime)

    const success = await http.fetch(new Request('http://doxa.test/payload'))
    expect(success.status).toBe(200)
    expect(await success.json()).toEqual({ ok: true, data: { id: 'payload-1' } })

    const failure = await http.fetch(new Request('http://doxa.test/failure'))
    expect(failure.status).toBe(409)
    expect(failure.headers.get('traceparent')).toBe(`00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`)
    expect(await failure.json()).toEqual({
      ok: false,
      code: 'conflict',
      message: 'The resource changed.',
      data: null,
      details: { version: 2 },
    })

    const unsafeDetails = await http.fetch(new Request('http://doxa.test/unsafe-details'))
    expect(unsafeDetails.status).toBe(400)
    expect(await unsafeDetails.json()).toEqual({
      ok: false,
      code: 'invalid_details',
      message: 'The request failed.',
      data: null,
    })

    const missing = await http.fetch(new Request('http://doxa.test/missing'))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      ok: false,
      code: 'route_not_found',
      message: 'No Doxa route matches GET /missing.',
      data: null,
    })
  })

  it('rejects invalid HttpError statuses and sanitizes malformed instances', async () => {
    expect(() => new HttpError(400, 'bad_request', 'Bad request.')).not.toThrow()
    expect(() => new HttpError(599, 'server_error', 'Server error.')).not.toThrow()
    for (const status of [399, 600, 400.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new HttpError(status, 'invalid_status', 'Must not escape.')).toThrow(TypeError)
    }

    const malformed = new HttpError(500, 'private_code', 'Private message.', { private: true })
    Object.defineProperty(malformed, 'status', { value: 700 })
    const runtime = {
      manifest: { routes: [{ id: 'route:test/malformed-error', method: 'GET', path: '/error' }] },
      logger: new Logger(),
      authenticateHttp: () =>
        Promise.resolve({ actor: { kind: 'anonymous' }, authentication: { state: 'anonymous' } }),
      admit: async (_seed: unknown, work: (context: object) => Promise<unknown>) =>
        work({ correlationId: 'malformed-error-test', trace: {} }),
      dispatchRoute: () => {
        throw malformed
      },
    } as unknown as DoxaRuntime

    const response = await new HonoHttpEngine(runtime).fetch(new Request('http://doxa.test/error'))
    expect(response.status).toBe(500)
    expect(response.headers.get('x-correlation-id')).toBe('malformed-error-test')
    expect(await response.json()).toEqual({
      ok: false,
      code: 'internal_error',
      message: 'The application could not complete the request.',
      data: null,
    })
  })

  it('keeps route cookies authoritative while preserving unrelated renewal cookies', async () => {
    const runtime = {
      manifest: {
        routes: [
          { id: 'route:test/session', method: 'GET', path: '/session' },
          { id: 'route:test/preferences', method: 'GET', path: '/preferences' },
        ],
      },
      logger: new Logger(),
      authenticateHttp: () =>
        Promise.resolve({
          actor: { kind: 'user', id: 'user-1' },
          authentication: { state: 'authenticated', identityId: 'user-1' },
          responseHeaders: { 'set-cookie': 'doxa_session=renewed; Path=/; HttpOnly' },
        }),
      admit: async (_seed: unknown, work: (context: object) => Promise<unknown>) =>
        work({ correlationId: 'cookie-test', trace: {} }),
      dispatchRoute: (id: string) =>
        id === 'route:test/session'
          ? Http.noContent({ 'set-cookie': 'doxa_session=route-owned; Path=/; HttpOnly' })
          : Http.noContent({ 'set-cookie': 'preferences=compact; Path=/' }),
    } as unknown as DoxaRuntime
    const http = new HonoHttpEngine(runtime)

    const session = await http.fetch(new Request('http://doxa.test/session'))
    expect(session.headers.getSetCookie()).toEqual(['doxa_session=route-owned; Path=/; HttpOnly'])

    const preferences = await http.fetch(new Request('http://doxa.test/preferences'))
    expect(preferences.headers.getSetCookie()).toEqual([
      'preferences=compact; Path=/',
      'doxa_session=renewed; Path=/; HttpOnly',
    ])
  })

  it('rejects declared and streamed request bodies above the configured byte limit', async () => {
    const runtime = {
      manifest: { routes: [{ id: 'route:test/body', method: 'POST', path: '/body' }] },
      logger: new Logger(),
      authenticateHttp: () =>
        Promise.resolve({
          actor: { kind: 'anonymous' },
          authentication: { state: 'anonymous' },
        }),
      admit: async (_seed: unknown, work: (context: object) => Promise<unknown>) =>
        work({ correlationId: 'body-limit-test', trace: {} }),
      dispatchRoute: () => ({ accepted: true }),
    } as unknown as DoxaRuntime
    const http = new HonoHttpEngine(runtime, { maxRequestBodyBytes: 16 })

    const declared = await http.fetch(
      new Request('http://doxa.test/body', {
        method: 'POST',
        headers: { 'content-length': '17' },
        body: 'small',
      }),
    )
    expect(declared.status).toBe(413)
    expect(await declared.json()).toEqual(
      expect.objectContaining({ ok: false, code: 'payload_too_large' }),
    )

    const streamed = await http.fetch(
      new Request('http://doxa.test/body', { method: 'POST', body: 'x'.repeat(17) }),
    )
    expect(streamed.status).toBe(413)
    expect(await streamed.json()).toEqual(
      expect.objectContaining({ ok: false, code: 'payload_too_large' }),
    )

    expect(
      (
        await http.fetch(
          new Request('http://doxa.test/body', { method: 'POST', body: 'x'.repeat(16) }),
        )
      ).status,
    ).toBe(200)
  })
})
