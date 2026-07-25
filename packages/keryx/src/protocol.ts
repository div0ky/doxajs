import {
  type ActorRef,
  type BroadcastDestination,
  type BroadcastMessage,
  type JsonValue,
  validateBroadcastChannelName,
} from '@doxajs/core'

export const KERYX_PROTOCOL = 2

export type KeryxOperation = 'connect' | 'subscribe' | 'unsubscribe' | 'publish' | 'receive'

export type ClientFrame =
  | { readonly protocol: 2; readonly type: 'subscribe'; readonly channel: BroadcastDestination }
  | { readonly protocol: 2; readonly type: 'unsubscribe'; readonly channel: BroadcastDestination }
  | { readonly protocol: 2; readonly type: 'ping'; readonly id?: string }

export interface KeryxErrorFrame {
  readonly protocol: 2
  readonly type: 'error'
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly fatal: boolean
  readonly operation: KeryxOperation
  readonly channel?: BroadcastDestination
}

export class KeryxProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly operation: KeryxOperation,
    readonly retryable: boolean,
    readonly fatal: boolean,
    readonly channel?: BroadcastDestination,
  ) {
    super(message)
    this.name = 'KeryxProtocolError'
  }
}

export function parseClientFrame(value: string): ClientFrame {
  let frame: Record<string, unknown>
  try {
    frame = JSON.parse(value) as Record<string, unknown>
  } catch {
    throw new KeryxProtocolError(
      'invalid_json',
      'The frame must contain valid JSON.',
      'receive',
      false,
      true,
    )
  }
  if (frame.protocol !== KERYX_PROTOCOL) {
    throw new KeryxProtocolError(
      'unsupported_protocol',
      `Keryx protocol ${KERYX_PROTOCOL} is required.`,
      'receive',
      false,
      true,
    )
  }
  if (frame.type === 'ping') {
    if (frame.id !== undefined && typeof frame.id !== 'string')
      throw new KeryxProtocolError(
        'invalid_frame',
        'Ping identifiers must be strings.',
        'receive',
        false,
        false,
      )
    return {
      protocol: KERYX_PROTOCOL,
      type: 'ping',
      ...(typeof frame.id === 'string' ? { id: frame.id } : {}),
    }
  }
  if (frame.type !== 'subscribe' && frame.type !== 'unsubscribe') {
    throw new KeryxProtocolError(
      'unsupported_operation',
      'The frame operation is not supported.',
      'receive',
      false,
      false,
    )
  }
  const operation = frame.type
  let channel: BroadcastDestination
  try {
    channel = normalizeDestination(frame.channel)
  } catch {
    throw new KeryxProtocolError(
      'invalid_channel',
      'The frame contains an invalid channel.',
      operation,
      false,
      false,
    )
  }
  return { protocol: KERYX_PROTOCOL, type: operation, channel }
}

export function normalizeDestination(value: unknown): BroadcastDestination {
  if (!isRecord(value)) throw new TypeError('Channel is required.')
  if (!['public', 'private', 'presence'].includes(String(value.kind)))
    throw new TypeError('Invalid channel kind.')
  if (typeof value.name !== 'string') throw new TypeError('Invalid channel name.')
  return Object.freeze({
    name: validateBroadcastChannelName(value.name),
    kind: value.kind as BroadcastDestination['kind'],
  })
}

export function parsePublishedMessage(value: unknown): BroadcastMessage {
  if (!isRecord(value)) throw new TypeError('Published message must be an object.')
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 200)
    throw new TypeError('Published message id is required.')
  if (typeof value.event !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(value.event))
    throw new TypeError('Published event name is invalid.')
  if (!Array.isArray(value.channels) || value.channels.length === 0)
    throw new TypeError('Published message channels are required.')
  if (typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt)))
    throw new TypeError('Published occurrence time is invalid.')
  assertJson(value.data)
  return Object.freeze({
    id: value.id,
    event: value.event,
    channels: Object.freeze(value.channels.map(normalizeDestination)),
    data: value.data as JsonValue,
    occurredAt: value.occurredAt,
  })
}

export function parseActor(value: unknown): ActorRef {
  if (!isRecord(value) || !['anonymous', 'user', 'service', 'system'].includes(String(value.kind)))
    throw new TypeError('Presence actor is invalid.')
  if (value.id !== undefined && typeof value.id !== 'string')
    throw new TypeError('Presence actor id is invalid.')
  return Object.freeze({
    kind: value.kind as ActorRef['kind'],
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
  })
}

export function destinationKey(destination: BroadcastDestination): string {
  return `${destination.kind}:${destination.name}`
}

export function actorKey(actor: ActorRef): string {
  return `${actor.kind}:${actor.id ?? ''}`
}

function assertJson(value: unknown, depth = 0): void {
  if (depth > 100) throw new TypeError('Published data is nested too deeply.')
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return
  if (Array.isArray(value)) {
    for (const item of value) assertJson(item, depth + 1)
    return
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) assertJson(item, depth + 1)
    return
  }
  throw new TypeError('Published data must be JSON.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
