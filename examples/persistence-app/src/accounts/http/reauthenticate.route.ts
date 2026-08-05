import { Auth, CurrentExecution, HttpError, type HttpRequest, Route } from '@doxajs/core'

import { requirePasswordSession } from './token-management.js'

export class ReauthenticateRoute extends Route {
  static override readonly id = 'reauthenticate'
  static override readonly access = 'accounts.reauthenticate'
  readonly method = 'POST'
  readonly path = '/auth/reauthenticate'

  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)

  async handle(request: HttpRequest) {
    const body = await request.json<{ password?: unknown }>()
    if (typeof body.password !== 'string') {
      throw new HttpError(422, 'validation_failed', 'password is required')
    }
    const identityId = requirePasswordSession(this.execution, false)
    const sessionId = this.execution.context.authentication.sessionId!
    const authenticatedAt = await this.auth.reauthenticate(identityId, sessionId, body.password, {
      ...(request.header('user-agent') ? { userAgent: request.header('user-agent')! } : {}),
    })
    return { authenticatedAt: authenticatedAt.toString() }
  }
}
