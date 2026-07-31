import { type HttpRequest, QueryBus, Route } from '@doxajs/core'

import { ReadAttachmentStatus } from '../queries/read-attachment-status.js'

export class AttachmentStatusRoute extends Route {
  static override readonly id = 'attachment-status'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/attachments/:id/status'

  private readonly queries = this.inject(QueryBus)

  handle(request: HttpRequest) {
    return this.queries.execute(ReadAttachmentStatus, request.param('id'))
  }
}
