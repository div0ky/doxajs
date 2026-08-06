export type HttpMethod = 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT'

export interface HttpEngine {
  fetch(request: Request): Promise<Response>
}

export interface HttpSuccess<Payload> {
  readonly ok: true
  readonly data: Payload
}

export interface HttpFailure {
  readonly ok: false
  readonly code: string
  readonly message: string
  readonly data: null
  readonly details?: unknown
}

export type HttpEnvelope<Payload> = HttpSuccess<Payload> | HttpFailure

export function httpSuccess<Payload>(data: Payload): HttpSuccess<Payload> {
  return Object.freeze({ ok: true, data })
}

export function httpFailure(code: string, message: string, details?: unknown): HttpFailure {
  return Object.freeze({
    ok: false,
    code,
    message,
    data: null,
    ...(details === undefined ? {} : { details }),
  })
}

export interface StandardSchemaIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
}

export interface StandardSchema<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
      options?: { readonly libraryOptions?: Record<string, unknown> | undefined },
    ) =>
      | { readonly value: Output; readonly issues?: undefined }
      | { readonly issues: readonly StandardSchemaIssue[] }
      | Promise<
          | { readonly value: Output; readonly issues?: undefined }
          | { readonly issues: readonly StandardSchemaIssue[] }
        >
    readonly types?:
      | {
          readonly input: Input
          readonly output: Output
        }
      | undefined
  }
}

export interface HttpValidationIssue {
  readonly message: string
  readonly path: readonly PropertyKey[]
}

export class HttpError extends Error {
  override readonly name: string = 'HttpError'

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options)
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new TypeError('HttpError status must be an integer from 400 through 599.')
    }
  }
}

export class HttpValidationError extends HttpError {
  override readonly name = 'HttpValidationError'

  constructor(readonly issues: readonly HttpValidationIssue[]) {
    super(422, 'validation_failed', 'The request did not pass validation.', { issues })
  }
}

export class HttpRequest {
  readonly url: URL

  constructor(
    readonly raw: Request,
    readonly params: Readonly<Record<string, string>>,
  ) {
    this.url = new URL(raw.url)
  }

  param(name: string): string {
    const value = this.params[name]
    if (value === undefined) {
      throw new HttpError(
        400,
        'missing_path_parameter',
        `Required path parameter ${name} is missing.`,
      )
    }
    return value
  }

  query(name: string): string | undefined {
    return this.url.searchParams.get(name) ?? undefined
  }

  queries(name: string): readonly string[] {
    return this.url.searchParams.getAll(name)
  }

  header(name: string): string | undefined {
    return this.raw.headers.get(name) ?? undefined
  }

  async json<Value = unknown>(): Promise<Value> {
    try {
      return (await this.raw.json()) as Value
    } catch (cause) {
      throw new HttpError(
        400,
        'invalid_json',
        'The request body must contain valid JSON.',
        undefined,
        {
          cause,
        },
      )
    }
  }

  text(): Promise<string> {
    return this.raw.text()
  }

  async validate<Input, Output>(
    schema: StandardSchema<Input, Output>,
    value: unknown,
  ): Promise<Output> {
    const result = await schema['~standard'].validate(value)
    if ('issues' in result && result.issues) {
      throw new HttpValidationError(
        result.issues.map((issue) => ({
          message: issue.message,
          path: (issue.path ?? []).map((part) =>
            typeof part === 'object' && part !== null && 'key' in part ? part.key : part,
          ),
        })),
      )
    }
    return result.value
  }
}

export abstract class Route<Output = unknown> extends DoxaRole {
  static readonly id: string = ''
  static readonly access: string = ''
  abstract readonly method: HttpMethod
  abstract readonly path: string
  abstract handle(request: HttpRequest): Output | Promise<Output>
}

export const Http = Object.freeze({
  json(value: unknown, status = 200, headers?: HttpHeaders): Response {
    return Response.json(httpSuccess(value), { status, ...(headers ? { headers } : {}) })
  },
  created(value: unknown, headers?: HttpHeaders): Response {
    return Response.json(httpSuccess(value), { status: 201, ...(headers ? { headers } : {}) })
  },
  accepted(value: unknown, headers?: HttpHeaders): Response {
    return Response.json(httpSuccess(value), { status: 202, ...(headers ? { headers } : {}) })
  },
  noContent(headers?: HttpHeaders): Response {
    return new Response(null, { status: 204, ...(headers ? { headers } : {}) })
  },
})

type HttpHeaders = Headers | Record<string, string> | Array<[string, string]>
import { DoxaRole } from './role.js'
