import { Auth, CurrentExecution, Http, HttpError, type HttpRequest, Route } from '@doxajs/core'

import { requirePasswordSession } from './token-management.js'

export class StartImpersonationRoute extends Route {
  static override readonly id = 'start-impersonation'
  static override readonly access = 'accounts.impersonate'
  readonly method = 'POST'
  readonly path = '/auth/impersonation'

  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)

  async handle(request: HttpRequest): Promise<Response> {
    const body = await request.json<{ targetIdentityId?: unknown; reason?: unknown }>()
    if (typeof body.targetIdentityId !== 'string' || typeof body.reason !== 'string') {
      throw new HttpError(422, 'validation_failed', 'targetIdentityId and reason are required')
    }
    const grant = await this.auth.startImpersonation(
      requirePasswordSession(this.execution),
      this.execution.context.authentication.sessionId!,
      body.targetIdentityId,
      body.reason,
    )
    return Http.json(
      {
        impersonator: { id: grant.identity.id },
        target: { id: grant.target.id },
        expiresAt: grant.session.impersonation!.expiresAt.toISOString(),
      },
      200,
      { 'set-cookie': this.auth.sessionCookie(grant) },
    )
  }
}
