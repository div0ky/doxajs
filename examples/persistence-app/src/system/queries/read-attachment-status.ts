import { HttpError, Query } from '@doxajs/core'

export class ReadAttachmentStatus extends Query<string, { readonly status: 'ready' }> {
  static readonly id = 'read-attachment-status'
  static override readonly access = 'public'

  handle(id: string): { readonly status: 'ready' } {
    if (id === 'scanning') {
      throw new HttpError(
        409,
        'direct_message_attachment_not_ready',
        'That attachment is not ready.',
      )
    }
    return { status: 'ready' }
  }
}
