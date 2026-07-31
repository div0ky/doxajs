import { createHash, randomUUID } from 'node:crypto'

import {
  type ActorRef,
  type BroadcastDestination,
  type BroadcastMessage,
  type RealtimeCommandThrottleDecision,
  type RealtimeCommandThrottleRequest,
} from '@doxajs/core'
import { createClient } from 'redis'

import { parseActor, parsePublishedMessage } from './protocol.js'

export type RedisBackplaneFrame =
  | { readonly kind: 'event'; readonly message: BroadcastMessage }
  | {
      readonly kind: 'presence'
      readonly type: 'presence_joined' | 'presence_left'
      readonly channel: BroadcastDestination
      readonly member: ActorRef
      readonly sourceConnectionId?: string
    }

export interface RedisPresenceJoin {
  readonly first: boolean
  readonly members: readonly ActorRef[]
}

export interface RedisPresenceLeave {
  readonly last: boolean
  readonly member?: ActorRef
}

type RedisClient = ReturnType<typeof createClient>

const JOIN_PRESENCE = `
local existing = redis.call('HGET', KEYS[2], ARGV[1])
if existing then
  redis.call('ZADD', KEYS[3], ARGV[5], ARGV[1])
  return cjson.encode({ first = false, members = redis.call('HVALS', KEYS[5]) })
end
redis.call('HSET', KEYS[1], ARGV[2], ARGV[3])
redis.call('HSET', KEYS[2], ARGV[1], cjson.encode({ actorKey = ARGV[4], member = ARGV[6] }))
redis.call('ZADD', KEYS[3], ARGV[5], ARGV[1])
local count = redis.call('HINCRBY', KEYS[4], ARGV[4], 1)
if count == 1 then redis.call('HSET', KEYS[5], ARGV[4], ARGV[6]) end
return cjson.encode({ first = count == 1, members = redis.call('HVALS', KEYS[5]) })
`

const LEAVE_PRESENCE = `
local encoded = redis.call('HGET', KEYS[2], ARGV[1])
if not encoded then return cjson.encode({ last = false }) end
local connection = cjson.decode(encoded)
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
local count = redis.call('HINCRBY', KEYS[4], connection.actorKey, -1)
local last = count <= 0
if last then
  redis.call('HDEL', KEYS[4], connection.actorKey)
  redis.call('HDEL', KEYS[5], connection.actorKey)
end
if redis.call('HLEN', KEYS[2]) == 0 then
  redis.call('HDEL', KEYS[1], ARGV[2])
  redis.call('DEL', KEYS[2], KEYS[3], KEYS[4], KEYS[5])
end
return cjson.encode({ last = last, member = connection.member })
`

const RENEW_PRESENCE = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then
  redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
  return 1
end
return 0
`

const CLEANUP_PRESENCE = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', ARGV[1], 'LIMIT', 0, ARGV[3])
local left = {}
for _, connectionId in ipairs(expired) do
  local encoded = redis.call('HGET', KEYS[2], connectionId)
  if encoded then
    local connection = cjson.decode(encoded)
    redis.call('HDEL', KEYS[2], connectionId)
    redis.call('ZREM', KEYS[3], connectionId)
    local count = redis.call('HINCRBY', KEYS[4], connection.actorKey, -1)
    if count <= 0 then
      redis.call('HDEL', KEYS[4], connection.actorKey)
      redis.call('HDEL', KEYS[5], connection.actorKey)
      table.insert(left, connection.member)
    end
  else
    redis.call('ZREM', KEYS[3], connectionId)
  end
end
if redis.call('HLEN', KEYS[2]) == 0 then
  redis.call('HDEL', KEYS[1], ARGV[2])
  redis.call('DEL', KEYS[2], KEYS[3], KEYS[4], KEYS[5])
end
return cjson.encode(left)
`

const PUBLISH_EVENT_ONCE = `
local accepted = redis.call('SET', KEYS[1], '1', 'PX', ARGV[1], 'NX')
if not accepted then return 0 end
redis.call('PUBLISH', ARGV[2], ARGV[3])
return 1
`

const CONSUME_REALTIME_COMMAND_THROTTLE = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  redis.call('PEXPIRE', KEYS[1], window)
  return { 0, math.max(1, tonumber(oldest[2]) + window - now) }
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window)
return { 1, 0 }
`

export class RedisBackplane {
  readonly #publisher: RedisClient
  readonly #subscriber: RedisClient
  readonly #commands: RedisClient
  readonly #channel: string
  readonly #prefix: string
  readonly #presenceChannelsKey: string
  #started = false
  #available = false

  constructor(
    url: string,
    applicationId: string,
    private readonly receive: (frame: RedisBackplaneFrame) => void,
    private readonly unavailable: (cause: unknown) => void,
  ) {
    const clientOptions = { url, socket: { reconnectStrategy: false as const } }
    this.#publisher = createClient(clientOptions)
    this.#subscriber = createClient(clientOptions)
    this.#commands = createClient(clientOptions)
    this.#prefix = `doxa:keryx:${applicationId}`
    this.#channel = `${this.#prefix}:frames`
    this.#presenceChannelsKey = `${this.#prefix}:presence:channels`
    for (const client of [this.#publisher, this.#subscriber, this.#commands]) {
      client.on('error', (error) => {
        if (this.#started && !client.isReady) {
          this.markUnavailable()
          this.unavailable(error)
        }
      })
      client.on('end', () => {
        if (this.#started) {
          this.markUnavailable()
          this.unavailable(new Error('Keryx Redis connection ended.'))
        }
      })
    }
    this.#subscriber.on('reconnecting', () => {
      if (this.#started) {
        this.markUnavailable()
        this.unavailable(new Error('Keryx Redis subscription reconnecting.'))
      }
    })
  }

  get available(): boolean {
    return this.#available
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error('Keryx Redis backplane is already started.')
    try {
      await Promise.all([
        this.#publisher.connect(),
        this.#subscriber.connect(),
        this.#commands.connect(),
      ])
      await this.#subscriber.subscribe(this.#channel, (raw) => {
        try {
          this.receive(parseFrame(JSON.parse(raw)))
        } catch {
          // Invalid backplane frames are ignored; only authenticated Keryx publishers can create them.
        }
      })
      this.#started = true
      this.#available = true
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async publish(frame: RedisBackplaneFrame): Promise<void> {
    if (!this.#available) throw new Error('Keryx Redis backplane is unavailable.')
    await this.#publisher.publish(this.#channel, JSON.stringify(frame))
  }

  async publishEventOnce(
    message: BroadcastMessage,
    retentionMilliseconds: number,
  ): Promise<boolean> {
    if (!this.#available) throw new Error('Keryx Redis backplane is unavailable.')
    const messageHash = createHash('sha256').update(message.id).digest('hex')
    const result = await this.#publisher.eval(PUBLISH_EVENT_ONCE, {
      keys: [`${this.#prefix}:messages:${messageHash}`],
      arguments: [
        String(retentionMilliseconds),
        this.#channel,
        JSON.stringify({ kind: 'event', message }),
      ],
    })
    return Number(result) === 1
  }

  async consumeAdmissionTicketOnce(
    ticketId: string,
    retentionMilliseconds: number,
  ): Promise<boolean> {
    if (!this.#available) throw new Error('Keryx Redis backplane is unavailable.')
    const ticketHash = createHash('sha256').update(ticketId).digest('hex')
    const result = await this.#commands.set(`${this.#prefix}:admission:${ticketHash}`, '1', {
      PX: retentionMilliseconds,
      NX: true,
    })
    return result === 'OK'
  }

  async consumeRealtimeCommandThrottle(
    request: RealtimeCommandThrottleRequest,
  ): Promise<RealtimeCommandThrottleDecision> {
    if (!this.#available) throw new Error('Keryx Redis backplane is unavailable.')
    const bucketHash = createHash('sha256')
      .update(`${request.actorId}:${request.command}`)
      .digest('hex')
    const result = (await this.#commands.eval(CONSUME_REALTIME_COMMAND_THROTTLE, {
      keys: [`${this.#prefix}:commands:${bucketHash}`],
      arguments: [
        String(request.throttle.windowMs),
        String(request.throttle.limit),
        `${request.requestId}:${randomUUID()}`,
      ],
    })) as unknown[]
    const allowed = Number(result[0]) === 1
    return Object.freeze({
      allowed,
      ...(allowed ? {} : { retryAfterMs: Math.max(1, Number(result[1]) || 1) }),
    })
  }

  async joinPresence(
    connectionId: string,
    destination: BroadcastDestination,
    actorKey: string,
    actor: ActorRef,
    expiresAt: number,
  ): Promise<RedisPresenceJoin> {
    const channelHash = hashChannel(destination)
    const result = await this.#commands.eval(JOIN_PRESENCE, {
      keys: this.#presenceKeys(channelHash),
      arguments: [
        connectionId,
        channelHash,
        JSON.stringify(destination),
        actorKey,
        String(expiresAt),
        JSON.stringify(actor),
      ],
    })
    const parsed = JSON.parse(String(result)) as { first?: unknown; members?: unknown }
    return Object.freeze({
      first: parsed.first === true,
      members: Object.freeze(
        Array.isArray(parsed.members)
          ? parsed.members.map((member) => parseActor(JSON.parse(String(member))))
          : [],
      ),
    })
  }

  async leavePresence(
    connectionId: string,
    destination: BroadcastDestination,
  ): Promise<RedisPresenceLeave> {
    const channelHash = hashChannel(destination)
    const result = await this.#commands.eval(LEAVE_PRESENCE, {
      keys: this.#presenceKeys(channelHash),
      arguments: [connectionId, channelHash],
    })
    const parsed = JSON.parse(String(result)) as { last?: unknown; member?: unknown }
    return Object.freeze({
      last: parsed.last === true,
      ...(parsed.member === undefined ? {} : { member: parseEncodedActor(parsed.member) }),
    })
  }

  async renewPresence(
    connectionId: string,
    destination: BroadcastDestination,
    expiresAt: number,
  ): Promise<void> {
    const channelHash = hashChannel(destination)
    const keys = this.#presenceKeys(channelHash)
    await this.#commands.eval(RENEW_PRESENCE, {
      keys: [keys[1]!, keys[2]!],
      arguments: [connectionId, String(expiresAt)],
    })
  }

  async cleanupExpired(
    now: number,
    limit = 100,
  ): Promise<
    readonly {
      readonly destination: BroadcastDestination
      readonly members: readonly ActorRef[]
    }[]
  > {
    const channels = await this.#commands.hGetAll(this.#presenceChannelsKey)
    const cleaned: {
      readonly destination: BroadcastDestination
      readonly members: readonly ActorRef[]
    }[] = []
    for (const [channelHash, encodedDestination] of Object.entries(channels)) {
      const destination = parseDestination(JSON.parse(encodedDestination))
      const result = await this.#commands.eval(CLEANUP_PRESENCE, {
        keys: this.#presenceKeys(channelHash),
        arguments: [String(now), channelHash, String(limit)],
      })
      const members = JSON.parse(String(result)) as unknown
      if (Array.isArray(members) && members.length > 0)
        cleaned.push({
          destination,
          members: Object.freeze(members.map(parseEncodedActor)),
        })
    }
    return Object.freeze(cleaned)
  }

  markUnavailable(): void {
    if (!this.#available) return
    this.#available = false
  }

  async stop(): Promise<void> {
    this.#started = false
    this.#available = false
    for (const client of [this.#publisher, this.#subscriber, this.#commands])
      if (client.isOpen) client.destroy()
  }

  #presenceKeys(channelHash: string): [string, string, string, string, string] {
    const prefix = `${this.#prefix}:presence:${channelHash}`
    return [
      this.#presenceChannelsKey,
      `${prefix}:connections`,
      `${prefix}:leases`,
      `${prefix}:actors`,
      `${prefix}:members`,
    ]
  }
}

function hashChannel(destination: BroadcastDestination): string {
  return createHash('sha256')
    .update(`${destination.kind}:${destination.name}`)
    .digest('hex')
    .slice(0, 32)
}

function parseFrame(value: unknown): RedisBackplaneFrame {
  if (!isRecord(value)) throw new TypeError('Invalid Keryx Redis frame.')
  if (value.kind === 'event')
    return Object.freeze({ kind: 'event', message: parsePublishedMessage(value.message) })
  if (
    value.kind !== 'presence' ||
    !['presence_joined', 'presence_left'].includes(String(value.type))
  )
    throw new TypeError('Invalid Keryx Redis frame.')
  return Object.freeze({
    kind: 'presence',
    type: value.type as 'presence_joined' | 'presence_left',
    channel: parseDestination(value.channel),
    member: parseActor(value.member),
    ...(typeof value.sourceConnectionId === 'string'
      ? { sourceConnectionId: value.sourceConnectionId }
      : {}),
  })
}

function parseDestination(value: unknown): BroadcastDestination {
  if (!isRecord(value) || typeof value.name !== 'string')
    throw new TypeError('Invalid Keryx presence channel.')
  if (!['public', 'private', 'presence'].includes(String(value.kind)))
    throw new TypeError('Invalid Keryx presence channel.')
  return Object.freeze({
    name: value.name,
    kind: value.kind as BroadcastDestination['kind'],
  })
}

function parseEncodedActor(value: unknown): ActorRef {
  return parseActor(typeof value === 'string' ? JSON.parse(value) : value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
