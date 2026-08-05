import { Feature } from '@doxajs/core'

import { UserLoggedIn } from './events/user-logged-in.js'
import { UserRegistered } from './events/user-registered.js'
import { LoginRoute } from './http/login.route.js'
import { IssueAccessTokenRoute } from './http/issue-access-token.route.js'
import { ListAccessTokensRoute } from './http/list-access-tokens.route.js'
import { LogoutRoute } from './http/logout.route.js'
import { MeRoute } from './http/me.route.js'
import { RegisterRoute } from './http/register.route.js'
import { RevokeAccessTokenRoute } from './http/revoke-access-token.route.js'
import { RotateAccessTokenRoute } from './http/rotate-access-token.route.js'
import { RecordUserLoggedIn } from './listeners/record-user-logged-in.js'
import { RecordUserRegistered } from './listeners/record-user-registered.js'
import { AccountEventRecorder } from './support/account-event-recorder.js'
import { AccountPolicy } from './policies/account.policy.js'
import { SendAuthEmail } from './actions/send-auth-email.js'
import { VerifyEmailRoute } from './http/verify-email.route.js'
import { RequestPasswordResetRoute } from './http/request-password-reset.route.js'
import { ResetPasswordRoute } from './http/reset-password.route.js'
import { ChangePasswordRoute } from './http/change-password.route.js'
import { ListSessionsRoute } from './http/list-sessions.route.js'
import { RevokeSessionRoute } from './http/revoke-session.route.js'
import { ResendVerificationRoute } from './http/resend-verification.route.js'
import { ReauthenticateRoute } from './http/reauthenticate.route.js'
import { StartImpersonationRoute } from './http/start-impersonation.route.js'
import { StopImpersonationRoute } from './http/stop-impersonation.route.js'

export class AccountsFeature extends Feature {
  id = 'accounts'
  providers = [AccountEventRecorder]
  routes = [
    RegisterRoute,
    LoginRoute,
    ReauthenticateRoute,
    StartImpersonationRoute,
    StopImpersonationRoute,
    LogoutRoute,
    MeRoute,
    IssueAccessTokenRoute,
    ListAccessTokensRoute,
    RotateAccessTokenRoute,
    RevokeAccessTokenRoute,
    VerifyEmailRoute,
    RequestPasswordResetRoute,
    ResetPasswordRoute,
    ChangePasswordRoute,
    ListSessionsRoute,
    RevokeSessionRoute,
    ResendVerificationRoute,
  ]
  actions = [SendAuthEmail]
  events = [UserRegistered, UserLoggedIn]
  listeners = [RecordUserRegistered, RecordUserLoggedIn]
  policies = [AccountPolicy]
}
