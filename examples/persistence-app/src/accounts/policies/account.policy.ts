import {
  allow,
  deny,
  isRecentPasswordAuthentication,
  Policy,
  type PolicyDecision,
  type PolicyRequest,
} from '@doxajs/core'

export class AccountPolicy extends Policy {
  static override readonly id = 'account'
  static override readonly abilities = [
    'accounts.logout',
    'accounts.reauthenticate',
    'accounts.password.change',
    'accounts.email.verify',
    'accounts.sessions.manage',
    'accounts.tokens.manage',
    'accounts.view-self',
    'accounts.impersonation.stop',
  ]

  decide(request: PolicyRequest): PolicyDecision {
    if (request.actor.kind !== 'user' || request.context.authentication.state !== 'authenticated') {
      return deny('account', 'authentication_required')
    }
    if (
      request.ability === 'accounts.impersonation.stop' &&
      (!request.context.authentication.impersonationGrantId ||
        !request.context.delegation.some(
          (hop) => hop.grantId === request.context.authentication.impersonationGrantId,
        ))
    ) {
      return deny('account', 'impersonation_required')
    }
    if (
      ['accounts.tokens.manage', 'accounts.sessions.manage', 'accounts.password.change'].includes(
        request.ability,
      ) &&
      !isRecentPasswordAuthentication(request.context.authentication)
    ) {
      return deny('account', 'fresh_session_required')
    }
    return allow('account')
  }
}
