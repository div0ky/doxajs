import { Auth, CurrentExecution, Http, type HttpRequest, Route } from '@doxajs/core'
import { instant } from '@doxajs/core/zod'
import { z } from 'zod'

import { publicAccessToken, requirePasswordSession } from './token-management.js'

const Input = z.object({
  name: z.string(),
  constraints: z.array(z.string()).optional(),
  expiresAt: instant().optional(),
})

export class IssueAccessTokenRoute extends Route {
  static override readonly id = 'issue-access-token'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'POST'
  readonly path = '/auth/tokens'

  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)

  async handle(request: HttpRequest): Promise<Response> {
    const identityId = requirePasswordSession(this.execution)
    const input = await request.validate(Input, await request.json())
    const grant = await this.auth.issueAccessToken(identityId, {
      name: input.name,
      ...(input.constraints ? { constraints: input.constraints } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    })
    return Http.created({
      accessToken: publicAccessToken(grant.accessToken),
      token: grant.token.reveal(),
    })
  }
}
