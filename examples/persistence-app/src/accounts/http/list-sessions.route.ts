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
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt?.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        revokedAt: session.revokedAt?.toISOString(),
        impersonation: session.impersonation
          ? {
              targetIdentityId: session.impersonation.targetIdentityId,
              reason: session.impersonation.reason,
              startedAt: session.impersonation.startedAt.toISOString(),
              expiresAt: session.impersonation.expiresAt.toISOString(),
            }
          : undefined,
        current: session.id === this.execution.context.authentication.sessionId,
      })),
    }
  }
}
