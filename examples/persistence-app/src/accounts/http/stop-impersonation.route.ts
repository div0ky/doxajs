import { Auth, CurrentExecution, Http, HttpError, type HttpRequest, Route } from '@doxajs/core'

export class StopImpersonationRoute extends Route {
  static override readonly id = 'stop-impersonation'
  static override readonly access = 'accounts.impersonation.stop'
  readonly method = 'DELETE'
  readonly path = '/auth/impersonation'

  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)

  async handle(_request: HttpRequest): Promise<Response> {
    const authentication = this.execution.context.authentication
    if (
      !authentication.identityId ||
      !authentication.sessionId ||
      !authentication.impersonationGrantId
    ) {
      throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    }
    const grant = await this.auth.stopImpersonation(
      authentication.identityId,
      authentication.sessionId,
      authentication.impersonationGrantId,
    )
    return Http.noContent({ 'set-cookie': this.auth.sessionCookie(grant) })
  }
}
