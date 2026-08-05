import { ActionBus, Auth, Http, type HttpRequest, Route } from '@doxajs/core'

import { UserRegistered } from '../events/user-registered.js'
import { credentials } from './credentials.js'
import { SendAuthEmail } from '../actions/send-auth-email.js'

export class RegisterRoute extends Route {
  static override readonly id = 'register'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/register'

  private readonly auth = this.inject(Auth)
  private readonly actions = this.inject(ActionBus)

  async handle(request: HttpRequest): Promise<Response> {
    const identity = await this.auth.register(await credentials(request))
    if (identity.contactEmail && identity.verification === 'unverified') {
      const verification = await this.auth.issueEmailVerification(identity.id)
      await this.actions.execute(SendAuthEmail, {
        kind: 'verification',
        to: identity.contactEmail,
        token: verification.token.reveal(),
      })
    }
    await UserRegistered.dispatch({ identityId: identity.id })
    return Http.created({ identity: publicIdentity(identity) })
  }
}

function publicIdentity(identity: import('@doxajs/core').AuthIdentity) {
  return {
    id: identity.id,
    identifier: identity.identifier,
    contactEmail: identity.contactEmail,
    verification: identity.verification,
    createdAt: identity.createdAt.toString(),
  }
}
