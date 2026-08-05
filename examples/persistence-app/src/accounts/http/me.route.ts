import { Auth, CurrentExecution, HttpError, type HttpRequest, Route } from '@doxajs/core'

export class MeRoute extends Route {
  static override readonly id = 'me'
  static override readonly access = 'accounts.view-self'
  readonly method = 'GET'
  readonly path = '/auth/me'

  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)

  async handle(_request: HttpRequest) {
    const identityId = this.execution.context.authentication.identityId
    if (!identityId)
      throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    const identity = await this.auth.findIdentity(identityId)
    if (!identity)
      throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    return {
      identity: {
        id: identity.id,
        identifier: identity.identifier,
        contactEmail: identity.contactEmail,
        verification: identity.verification,
      },
      actor: this.execution.context.actor,
      initiator: this.execution.context.initiator,
      delegation: this.execution.context.delegation,
      authentication: {
        method: this.execution.context.authentication.method,
        assurance: this.execution.context.authentication.assurance,
        sessionId: this.execution.context.authentication.sessionId,
        credentialId: this.execution.context.authentication.credentialId,
        constraints: this.execution.context.authentication.constraints,
      },
    }
  }
}
