import { Auth, CurrentExecution, type HttpRequest, Route } from '@doxajs/core'

export class ListSessionsRoute extends Route {
  static override readonly id = 'list-sessions'
  static override readonly access = 'accounts.sessions.manage'
  readonly method = 'GET'
  readonly path = '/auth/sessions'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(_request: HttpRequest) {
    const sessions = await this.auth.listSessions(this.execution.context.authentication.identityId!)
    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toString(),
        lastSeenAt: session.lastSeenAt?.toString(),
        expiresAt: session.expiresAt.toString(),
        revokedAt: session.revokedAt?.toString(),
        current: session.id === this.execution.context.authentication.sessionId,
      })),
    }
  }
}
