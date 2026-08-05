import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import {
  BroadcastTransport,
  type BroadcastConnectionAdmission,
  type BroadcastDestination,
  type BroadcastGateway,
  type BroadcastMessage,
  type BroadcastRuntimeRoles,
  type RealtimeCommandThrottleDecision,
  type RealtimeCommandThrottleRequest,
  type Disposes,
  type Drains,
  type LifecycleContext,
  type Starts,
  type Stops,
} from '@doxajs/core'
import WebSocket, { WebSocketServer } from 'ws'

import {
  KERYX_PROTOCOL,
  KeryxProtocolError,
  actorKey,
  destinationKey,
  parseClientFrame,
  parsePublishedMessage,
} from './protocol.js'
import { RedisBackplane, type RedisBackplaneFrame } from './redis-backplane.js'
import {
  KeryxAdmissionTickets,
  KeryxAuthenticationError,
  KeryxPublishAuthenticator,
  type KeryxConnectionTicketAdmission,
  type KeryxConnectionTicketGrant,
  type KeryxConnectionTicketInput,
} from './security.js'

export { KERYX_PROTOCOL, KeryxProtocolError, parseClientFrame } from './protocol.js'
export {
  KeryxAdmissionTickets,
  KeryxAuthenticationError,
  KeryxPublishAuthenticator,
  type KeryxConnectionTicketAdmission,
  type KeryxConnectionTicketGrant,
  type KeryxConnectionTicketInput,
  type KeryxPublishCredentials,
} from './security.js'

export type KeryxTopology = 'single' | 'redis'
export const KERYX_SUBPROTOCOL = 'doxa.realtime.v3'
const KERYX_TICKET_SUBPROTOCOL_PREFIX = 'doxa.ticket.'

export interface KeryxOptions {
  readonly applicationId?: string
  readonly port?: number
  readonly host?: string
  readonly path?: string
  readonly key?: string
  readonly secret?: string
  readonly publishUrl?: string
  readonly topology?: KeryxTopology
  readonly redisUrl?: string
  readonly maxPayloadBytes?: number
  readonly maxPublishPayloadBytes?: number
  readonly maxPendingFrames?: number
  readonly maxCommandThrottleBuckets?: number
  readonly admissionTicketMilliseconds?: number
  readonly maxConsumedAdmissionTickets?: number
  readonly heartbeatMilliseconds?: number
  readonly presenceLeaseMilliseconds?: number
  readonly publishTimeoutMilliseconds?: number
  readonly messageDeduplicationMilliseconds?: number
  readonly maxDeduplicatedMessages?: number
  readonly maxBufferedBytes?: number
}

interface Connection {
  readonly id: string
  readonly socket: WebSocket
  readonly admission: BroadcastConnectionAdmission
  readonly subscriptions: Map<string, BroadcastDestination>
  alive: boolean
  inbound: Promise<void>
  queuedFrames: number
}

interface PendingFrame {
  readonly data: WebSocket.RawData
  readonly binary: boolean
}

interface ResolvedKeryxOptions {
  readonly applicationId: string
  readonly port: number
  readonly host: string
  readonly path: string
  readonly key: string
  readonly secret?: string
  readonly publishUrl?: string
  readonly topology: KeryxTopology
  readonly redisUrl?: string
  readonly maxPayloadBytes: number
  readonly maxPublishPayloadBytes: number
  readonly maxPendingFrames: number
  readonly maxCommandThrottleBuckets: number
  readonly admissionTicketMilliseconds: number
  readonly maxConsumedAdmissionTickets: number
  readonly heartbeatMilliseconds: number
  readonly presenceLeaseMilliseconds: number
  readonly publishTimeoutMilliseconds: number
  readonly messageDeduplicationMilliseconds: number
  readonly maxDeduplicatedMessages: number
  readonly maxBufferedBytes: number
}

const DEFAULT_ROLES: BroadcastRuntimeRoles = {
  web: true,
  worker: true,
  scheduler: true,
  requiresRemotePublishing: false,
}

export class Keryx extends BroadcastTransport implements Starts, Drains, Stops, Disposes {
  static readonly id = 'broadcasting'
  #gateway?: BroadcastGateway
  #roles = DEFAULT_ROLES
  #server: Server | undefined
  #webSockets: WebSocketServer | undefined
  #heartbeat: NodeJS.Timeout | undefined
  #pulseRunning = false
  #connections = new Set<Connection>()
  #publishing = new Set<Promise<void>>()
  #publishedMessageIds = new Map<string, number>()
  #consumedAdmissionTickets = new Map<string, number>()
  #commandAttempts = new Map<string, { attempts: number[]; expiresAt: number }>()
  #draining = false
  #ready = false
  #backplane: RedisBackplane | undefined
  #backplaneRecovery: Promise<void> | undefined
  readonly #options: ResolvedKeryxOptions
  readonly #authenticator: KeryxPublishAuthenticator | undefined
  readonly #admissionTickets: KeryxAdmissionTickets | undefined

  constructor(options: KeryxOptions = {}) {
    super()
    const path = options.path ?? '/app'
    if (!path.startsWith('/')) throw new TypeError('Keryx path must begin with /.')
    if (options.topology === 'redis' && !options.redisUrl)
      throw new TypeError('Keryx Redis topology requires redisUrl.')
    if (
      options.messageDeduplicationMilliseconds !== undefined &&
      (!Number.isSafeInteger(options.messageDeduplicationMilliseconds) ||
        options.messageDeduplicationMilliseconds <= 0)
    )
      throw new TypeError('Keryx messageDeduplicationMilliseconds must be a positive integer.')
    if (
      options.maxDeduplicatedMessages !== undefined &&
      (!Number.isSafeInteger(options.maxDeduplicatedMessages) ||
        options.maxDeduplicatedMessages <= 0)
    )
      throw new TypeError('Keryx maxDeduplicatedMessages must be a positive integer.')
    if (
      options.admissionTicketMilliseconds !== undefined &&
      (!Number.isSafeInteger(options.admissionTicketMilliseconds) ||
        options.admissionTicketMilliseconds <= 0)
    )
      throw new TypeError('Keryx admissionTicketMilliseconds must be a positive integer.')
    if (
      options.maxConsumedAdmissionTickets !== undefined &&
      (!Number.isSafeInteger(options.maxConsumedAdmissionTickets) ||
        options.maxConsumedAdmissionTickets <= 0)
    )
      throw new TypeError('Keryx maxConsumedAdmissionTickets must be a positive integer.')
    if (
      options.maxCommandThrottleBuckets !== undefined &&
      (!Number.isSafeInteger(options.maxCommandThrottleBuckets) ||
        options.maxCommandThrottleBuckets <= 0)
    )
      throw new TypeError('Keryx maxCommandThrottleBuckets must be a positive integer.')
    this.#options = {
      applicationId: options.applicationId ?? 'default',
      port: options.port ?? 6001,
      host: options.host ?? '127.0.0.1',
      path,
      key: options.key ?? 'default',
      ...(options.secret ? { secret: options.secret } : {}),
      ...(options.publishUrl ? { publishUrl: options.publishUrl } : {}),
      topology: options.topology ?? 'single',
      ...(options.redisUrl ? { redisUrl: options.redisUrl } : {}),
      maxPayloadBytes: options.maxPayloadBytes ?? 64 * 1024,
      maxPublishPayloadBytes: options.maxPublishPayloadBytes ?? 256 * 1024,
      maxPendingFrames: options.maxPendingFrames ?? 16,
      maxCommandThrottleBuckets: options.maxCommandThrottleBuckets ?? 50_000,
      admissionTicketMilliseconds: options.admissionTicketMilliseconds ?? 30_000,
      maxConsumedAdmissionTickets: options.maxConsumedAdmissionTickets ?? 50_000,
      heartbeatMilliseconds: options.heartbeatMilliseconds ?? 30_000,
      presenceLeaseMilliseconds:
        options.presenceLeaseMilliseconds ?? (options.heartbeatMilliseconds ?? 30_000) * 3,
      publishTimeoutMilliseconds: options.publishTimeoutMilliseconds ?? 10_000,
      messageDeduplicationMilliseconds:
        options.messageDeduplicationMilliseconds ?? 24 * 60 * 60 * 1_000,
      maxDeduplicatedMessages: options.maxDeduplicatedMessages ?? 50_000,
      maxBufferedBytes: options.maxBufferedBytes ?? 1024 * 1024,
    }
    this.#authenticator = options.secret
      ? new KeryxPublishAuthenticator({
          key: options.key ?? 'default',
          secret: options.secret,
        })
      : undefined
    this.#admissionTickets = options.secret
      ? new KeryxAdmissionTickets(
          options.applicationId ?? 'default',
          options.secret,
          options.admissionTicketMilliseconds ?? 30_000,
        )
      : undefined
  }

  selectRoles(roles: BroadcastRuntimeRoles): void {
    if (this.#server || this.#ready) throw new Error('Keryx roles must be selected before startup.')
    this.#roles = Object.freeze({ ...roles })
  }

  bind(gateway: BroadcastGateway): void {
    if (this.#gateway) throw new Error('Keryx is already bound to a Doxa runtime.')
    if (this.#server) throw new Error('Keryx must be bound before it starts.')
    this.#gateway = gateway
  }

  async start(context: LifecycleContext): Promise<void> {
    if (context.signal.aborted) throw context.signal.reason
    if (!this.#gateway) throw new Error('The Doxa runtime did not bind Keryx.')
    if (this.#server || this.#ready) throw new Error('Keryx is already started.')
    this.#draining = false
    if (!this.#roles.web) {
      if (
        this.#roles.requiresRemotePublishing &&
        (!this.#options.publishUrl || !this.#authenticator)
      ) {
        throw new Error(
          'Queued broadcasts in a non-web role require DOXA_KERYX_PUBLISH_URL and DOXA_KERYX_SECRET.',
        )
      }
      this.#ready = true
      return
    }

    if (this.#options.topology === 'redis') {
      this.#backplane = this.#createBackplane()
      await this.#backplane.start()
    }

    const server = createServer((request, response) => {
      void this.#handleHttp(request, response)
    })
    const webSockets = new WebSocketServer({
      server,
      path: this.#options.path,
      maxPayload: this.#options.maxPayloadBytes,
      perMessageDeflate: false,
      handleProtocols: (protocols) =>
        protocols.has(KERYX_SUBPROTOCOL)
          ? KERYX_SUBPROTOCOL
          : ([...protocols].find(
              (protocol) => !protocol.startsWith(KERYX_TICKET_SUBPROTOCOL_PREFIX),
            ) ?? false),
    })
    webSockets.on('connection', (socket, request) => void this.#accept(socket, request))
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error): void => reject(error)
        server.once('error', failed)
        server.listen(this.#options.port, this.#options.host, () => {
          server.off('error', failed)
          resolve()
        })
      })
    } catch (error) {
      webSockets.close()
      await this.#backplane?.stop().catch(() => undefined)
      this.#backplane = undefined
      throw error
    }
    this.#server = server
    this.#webSockets = webSockets
    this.#heartbeat = setInterval(() => void this.#pulse(), this.#options.heartbeatMilliseconds)
    this.#heartbeat.unref()
    this.#ready = true
  }

  async publish(message: BroadcastMessage): Promise<void> {
    const normalized = parsePublishedMessage(message)
    if (!this.#ready || this.#draining) throw new Error('Keryx is not accepting broadcasts.')
    const work = this.#roles.web
      ? this.#acceptPublished(normalized)
      : this.#publishRemotely(normalized)
    this.#publishing.add(work)
    try {
      await work
    } finally {
      this.#publishing.delete(work)
    }
  }

  async consumeRealtimeCommandThrottle(
    request: RealtimeCommandThrottleRequest,
  ): Promise<RealtimeCommandThrottleDecision> {
    if (this.#options.topology === 'redis') {
      if (!this.#backplane) throw new Error('Keryx Redis backplane is unavailable.')
      return await this.#backplane.consumeRealtimeCommandThrottle(request)
    }
    const now = Date.now()
    const key = JSON.stringify([request.actorId, request.command])
    const currentBucket = this.#commandAttempts.get(key)
    if (currentBucket?.expiresAt && currentBucket.expiresAt <= now) {
      this.#commandAttempts.delete(key)
    }
    if (
      !this.#commandAttempts.has(key) &&
      this.#commandAttempts.size >= this.#options.maxCommandThrottleBuckets
    ) {
      for (const [attemptKey, bucket] of this.#commandAttempts)
        if (bucket.expiresAt <= now) this.#commandAttempts.delete(attemptKey)
      if (this.#commandAttempts.size >= this.#options.maxCommandThrottleBuckets) {
        return { allowed: false, retryAfterMs: request.throttle.windowMs }
      }
    }
    const cutoff = now - request.throttle.windowMs
    const attempts = (this.#commandAttempts.get(key)?.attempts ?? []).filter(
      (value) => value > cutoff,
    )
    if (attempts.length >= request.throttle.limit) {
      this.#commandAttempts.set(key, {
        attempts,
        expiresAt: attempts.at(-1)! + request.throttle.windowMs,
      })
      return {
        allowed: false,
        retryAfterMs: Math.max(1, attempts[0]! + request.throttle.windowMs - now),
      }
    }
    attempts.push(now)
    this.#commandAttempts.set(key, { attempts, expiresAt: now + request.throttle.windowMs })
    return { allowed: true }
  }

  issueConnectionTicket(input: KeryxConnectionTicketInput): KeryxConnectionTicketGrant {
    if (!this.#roles.web || !this.#ready || this.#draining)
      throw new Error('Keryx is not accepting connection tickets.')
    if (!this.#admissionTickets)
      throw new Error('Keryx connection tickets require DOXA_KERYX_SECRET.')
    return this.#admissionTickets.issue(input)
  }

  async drain(_context: LifecycleContext): Promise<void> {
    this.#draining = true
    this.#ready = false
    this.#webSockets?.close()
    await Promise.allSettled([...this.#publishing])
  }

  async stop(_context: LifecycleContext): Promise<void> {
    this.#draining = true
    this.#ready = false
    if (this.#heartbeat) clearInterval(this.#heartbeat)
    this.#heartbeat = undefined
    for (const connection of this.#connections) connection.socket.close(1001, 'Server shutdown')
    await new Promise<void>((resolve) => {
      const server = this.#server
      if (!server?.listening) return resolve()
      server.close(() => resolve())
    })
    await this.#backplane?.stop()
    await this.#backplaneRecovery?.catch(() => undefined)
    this.#backplaneRecovery = undefined
    this.#backplane = undefined
    this.#server = undefined
    this.#webSockets = undefined
  }

  dispose(_context: LifecycleContext): void {
    for (const connection of this.#connections) connection.socket.terminate()
    this.#connections.clear()
    this.#publishedMessageIds.clear()
    this.#consumedAdmissionTickets.clear()
    this.#commandAttempts.clear()
  }

  get address(): {
    readonly host: string
    readonly port: number
    readonly path: string
    readonly publishPath: string
  } {
    const address = this.#server?.address()
    return {
      host: this.#options.host,
      port: typeof address === 'object' && address ? address.port : this.#options.port,
      path: this.#options.path,
      publishPath: this.#publishPath(),
    }
  }

  get ready(): boolean {
    return this.#ready
  }

  get listenerActive(): boolean {
    return this.#server?.listening === true
  }

  async #accept(socket: WebSocket, incoming: IncomingMessage): Promise<void> {
    if (!this.#ready || this.#draining) {
      socket.close(1012, 'Keryx is not ready')
      return
    }
    const id = randomUUID()
    const pending: PendingFrame[] = []
    let closed = false
    const receivedPending = (data: WebSocket.RawData, binary: boolean): void => {
      if (pending.length >= this.#options.maxPendingFrames) {
        this.#sendError(
          socket,
          new KeryxProtocolError(
            'authentication_buffer_exceeded',
            'Too many frames arrived before authentication completed.',
            'connect',
            true,
            true,
          ),
        )
        socket.close(4408, 'Authentication buffer exceeded')
        return
      }
      pending.push({ data, binary })
    }
    const closedPending = (): void => {
      closed = true
    }
    socket.on('message', receivedPending)
    socket.once('close', closedPending)
    socket.once('error', () => undefined)
    try {
      const ticket = admissionTicketFromIncoming(incoming)
      const admission = ticket
        ? await this.#admitConnectionTicket(id, ticket, incoming)
        : await this.#gateway!.connect(id, requestFromIncoming(incoming))
      if (closed || socket.readyState !== WebSocket.OPEN) return
      socket.off('message', receivedPending)
      socket.off('close', closedPending)
      const connection: Connection = {
        id,
        socket,
        admission,
        subscriptions: new Map(),
        alive: true,
        inbound: Promise.resolve(),
        queuedFrames: 0,
      }
      this.#connections.add(connection)
      socket.on('pong', () => (connection.alive = true))
      socket.on('message', (data, binary) => this.#queueFrame(connection, data, binary))
      socket.once('close', () => void this.#disconnect(connection))
      this.#send(socket, {
        protocol: KERYX_PROTOCOL,
        type: 'connected',
        connectionId: id,
      })
      for (const frame of pending) this.#queueFrame(connection, frame.data, frame.binary)
    } catch {
      this.#sendError(
        socket,
        new KeryxProtocolError(
          'authentication_failed',
          'Connection admission failed.',
          'connect',
          false,
          true,
        ),
      )
      socket.close(4401, 'Connection admission failed')
    }
  }

  async #admitConnectionTicket(
    connectionId: string,
    ticket: string,
    incoming: IncomingMessage,
  ): Promise<BroadcastConnectionAdmission> {
    if (!this.#admissionTickets)
      throw new KeryxAuthenticationError(
        'admission_ticket_unavailable',
        401,
        'Keryx admission credentials are not configured.',
      )
    const origin = incoming.headers.origin
    if (!origin)
      throw new KeryxAuthenticationError(
        'admission_origin_required',
        401,
        'Keryx admission credentials require a browser Origin.',
      )
    const admission = this.#admissionTickets.open(ticket, origin)
    if (!(await this.#consumeAdmissionTicket(admission)))
      throw new KeryxAuthenticationError(
        'admission_ticket_replayed',
        409,
        'Keryx admission credentials were already used.',
      )
    return Object.freeze({
      connectionId,
      actor: admission.actor,
      ...(admission.initiator ? { initiator: admission.initiator } : {}),
      ...(admission.delegation ? { delegation: admission.delegation } : {}),
      authentication: admission.authentication,
      ...(admission.tenant ? { tenant: admission.tenant } : {}),
      correlationId: admission.correlationId,
    })
  }

  async #consumeAdmissionTicket(admission: KeryxConnectionTicketAdmission): Promise<boolean> {
    const retentionMilliseconds = Math.max(1, admission.expiresAt - Date.now())
    if (this.#options.topology === 'redis') {
      if (!this.#backplane) throw new Error('Keryx Redis backplane is unavailable.')
      return await this.#backplane.consumeAdmissionTicketOnce(
        admission.ticketId,
        retentionMilliseconds,
      )
    }
    const now = Date.now()
    for (const [ticketId, expiresAt] of this.#consumedAdmissionTickets)
      if (expiresAt <= now) this.#consumedAdmissionTickets.delete(ticketId)
    if ((this.#consumedAdmissionTickets.get(admission.ticketId) ?? 0) > now) return false
    if (this.#consumedAdmissionTickets.size >= this.#options.maxConsumedAdmissionTickets)
      return false
    this.#consumedAdmissionTickets.set(admission.ticketId, admission.expiresAt)
    return true
  }

  #queueFrame(connection: Connection, data: WebSocket.RawData, binary: boolean): void {
    if (connection.queuedFrames >= this.#options.maxPendingFrames) {
      this.#reject(
        connection,
        new KeryxProtocolError(
          'inbound_queue_exceeded',
          'Too many realtime frames are pending.',
          'receive',
          true,
          true,
        ),
      )
      return
    }
    connection.queuedFrames += 1
    connection.inbound = connection.inbound
      .then(() => this.#receive(connection, data, binary))
      .catch(() =>
        this.#reject(
          connection,
          new KeryxProtocolError(
            'message_failed',
            'Keryx could not process the frame.',
            'receive',
            true,
            false,
          ),
        ),
      )
      .finally(() => {
        connection.queuedFrames -= 1
      })
  }

  async #receive(connection: Connection, data: WebSocket.RawData, binary: boolean): Promise<void> {
    if (!(await this.#validateConnection(connection))) return
    if (binary) {
      this.#reject(
        connection,
        new KeryxProtocolError(
          'binary_not_supported',
          'Keryx accepts JSON text frames only.',
          'receive',
          false,
          true,
        ),
      )
      return
    }
    let frame
    try {
      frame = parseClientFrame(data.toString())
    } catch (error) {
      this.#reject(
        connection,
        error instanceof KeryxProtocolError
          ? error
          : new KeryxProtocolError(
              'invalid_frame',
              'Keryx could not parse the frame.',
              'receive',
              false,
              false,
            ),
      )
      return
    }
    if (frame.type === 'ping') {
      this.#send(connection.socket, {
        protocol: KERYX_PROTOCOL,
        type: 'pong',
        ...(frame.id ? { id: frame.id } : {}),
      })
      return
    }
    if (frame.type === 'command') {
      const result = await this.#gateway!.command(connection.admission, {
        id: frame.id,
        command: frame.command,
        payload: frame.payload,
      })
      this.#send(connection.socket, {
        protocol: KERYX_PROTOCOL,
        type: 'command_ack',
        ...result,
      })
      return
    }
    const destination = frame.channel
    const key = destinationKey(destination)
    if (frame.type === 'subscribe') {
      if (connection.subscriptions.has(key)) {
        this.#send(connection.socket, {
          protocol: KERYX_PROTOCOL,
          type: 'subscribed',
          channel: destination,
          ...(destination.kind === 'presence' ? { members: await this.#presenceMembers(key) } : {}),
        })
        return
      }
      try {
        const result = await this.#gateway!.subscribe(connection.admission, destination)
        if (destination.kind === 'presence' && result.member) {
          const presence = await this.#joinPresence(connection, destination, result.member)
          connection.subscriptions.set(key, destination)
          this.#send(connection.socket, {
            protocol: KERYX_PROTOCOL,
            type: 'subscribed',
            channel: destination,
            members: presence.members,
          })
          if (presence.first)
            await this.#announcePresence(
              'presence_joined',
              destination,
              result.member,
              connection.id,
            )
        } else {
          connection.subscriptions.set(key, destination)
          this.#send(connection.socket, {
            protocol: KERYX_PROTOCOL,
            type: 'subscribed',
            channel: destination,
          })
        }
      } catch {
        this.#reject(
          connection,
          new KeryxProtocolError(
            'subscription_denied',
            'The subscription was not admitted.',
            'subscribe',
            false,
            false,
            destination,
          ),
        )
      }
      return
    }
    try {
      await this.#leave(connection, destination)
      this.#send(connection.socket, {
        protocol: KERYX_PROTOCOL,
        type: 'unsubscribed',
        channel: destination,
      })
    } catch {
      this.#reject(
        connection,
        new KeryxProtocolError(
          'unsubscribe_failed',
          'Keryx could not leave the channel.',
          'unsubscribe',
          true,
          false,
          destination,
        ),
      )
    }
  }

  async #joinPresence(
    connection: Connection,
    destination: BroadcastDestination,
    member: BroadcastConnectionAdmission['actor'],
  ): Promise<{
    readonly first: boolean
    readonly members: readonly BroadcastConnectionAdmission['actor'][]
  }> {
    if (this.#options.topology === 'redis') {
      if (!this.#backplane) throw new Error('Keryx Redis backplane is unavailable.')
      return await this.#backplane.joinPresence(
        connection.id,
        destination,
        actorKey(member),
        member,
        Date.now() + this.#options.presenceLeaseMilliseconds,
      )
    }
    return {
      first: !this.#hasPresenceMember(destinationKey(destination), member),
      members: this.#presenceMembersLocal(destinationKey(destination), member),
    }
  }

  async #leave(connection: Connection, destination: BroadcastDestination): Promise<void> {
    const key = destinationKey(destination)
    if (!connection.subscriptions.delete(key)) return
    await this.#gateway!.unsubscribe(connection.admission, destination)
    if (destination.kind !== 'presence') return
    if (this.#options.topology === 'redis') {
      if (!this.#backplane) throw new Error('Keryx Redis backplane is unavailable.')
      const result = await this.#backplane.leavePresence(connection.id, destination)
      if (result.last && result.member)
        await this.#announcePresence('presence_left', destination, result.member, connection.id)
      return
    }
    if (!this.#hasPresenceMember(key, connection.admission.actor))
      this.#broadcastPresenceLocal(
        connection.id,
        key,
        destination,
        'presence_left',
        connection.admission.actor,
      )
  }

  async #disconnect(connection: Connection): Promise<void> {
    if (!this.#connections.delete(connection)) return
    for (const destination of [...connection.subscriptions.values()])
      await this.#leave(connection, destination).catch(() => undefined)
  }

  async #acceptPublished(message: BroadcastMessage): Promise<void> {
    if (this.#options.topology === 'redis') {
      if (!this.#backplane) throw new Error('Keryx Redis backplane is unavailable.')
      await this.#backplane.publishEventOnce(
        message,
        this.#options.messageDeduplicationMilliseconds,
      )
      return
    }
    const now = Date.now()
    for (const [id, expiresAt] of this.#publishedMessageIds)
      if (expiresAt <= now) this.#publishedMessageIds.delete(id)
    if ((this.#publishedMessageIds.get(message.id) ?? 0) > now) return
    while (this.#publishedMessageIds.size >= this.#options.maxDeduplicatedMessages) {
      const oldest = this.#publishedMessageIds.keys().next().value as string | undefined
      if (!oldest) break
      this.#publishedMessageIds.delete(oldest)
    }
    this.#publishedMessageIds.set(message.id, now + this.#options.messageDeduplicationMilliseconds)
    this.#publishLocal(message)
  }

  #publishLocal(message: BroadcastMessage): void {
    const serializedByChannel = new Map<string, string>()
    for (const connection of this.#connections) {
      if (this.#impersonationExpired(connection)) {
        connection.socket.close(4401, 'Authentication expired')
        continue
      }
      for (const channel of message.channels) {
        const key = destinationKey(channel)
        if (!connection.subscriptions.has(key)) continue
        if (connection.socket.bufferedAmount > this.#options.maxBufferedBytes) {
          connection.socket.close(4408, 'Subscriber is too slow')
          break
        }
        const serialized =
          serializedByChannel.get(key) ??
          JSON.stringify({
            protocol: KERYX_PROTOCOL,
            type: 'event',
            id: message.id,
            event: message.event,
            channel,
            data: message.data,
            occurredAt: message.occurredAt,
          })
        serializedByChannel.set(key, serialized)
        try {
          connection.socket.send(serialized)
        } catch {
          connection.socket.terminate()
        }
      }
    }
  }

  async #publishRemotely(message: BroadcastMessage): Promise<void> {
    if (!this.#options.publishUrl || !this.#authenticator)
      throw new Error(
        'Remote Keryx publishing requires DOXA_KERYX_PUBLISH_URL and DOXA_KERYX_SECRET.',
      )
    const path = this.#publishPath()
    const url = new URL(path, ensureTrailingSlash(this.#options.publishUrl))
    const body = JSON.stringify({ protocol: KERYX_PROTOCOL, message })
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new Error('Keryx publish request timed out.')),
      this.#options.publishTimeoutMilliseconds,
    )
    timeout.unref()
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.#authenticator.headers('POST', path, body),
        },
        body,
        signal: controller.signal,
      })
      if (response.status !== 202) {
        const detail = await response.text().catch(() => '')
        throw new Error(
          `Keryx publish failed with HTTP ${response.status}${detail ? `: ${detail}` : '.'}`,
        )
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async #handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://keryx.internal')
    if (request.method === 'GET' && url.pathname === '/ready') {
      response.writeHead(this.#ready ? 204 : 503).end()
      return
    }
    if (request.method !== 'POST' || url.pathname !== this.#publishPath()) {
      response.writeHead(404).end()
      return
    }
    if (this.#draining || !this.#ready) {
      writeJson(response, 503, { code: 'keryx_unavailable' })
      return
    }
    if (!this.#authenticator) {
      writeJson(response, 503, { code: 'publishing_not_configured' })
      return
    }
    try {
      const body = await readBody(request, this.#options.maxPublishPayloadBytes)
      const fetchRequest = new Request(url, {
        method: 'POST',
        headers: requestHeaders(request),
        body,
      })
      this.#authenticator.verify(fetchRequest, body)
      const envelope = JSON.parse(body) as Record<string, unknown>
      if (envelope.protocol !== KERYX_PROTOCOL)
        throw new TypeError(`Keryx protocol ${KERYX_PROTOCOL} is required.`)
      const message = parsePublishedMessage(envelope.message)
      await this.#acceptPublished(message)
      response.writeHead(202).end()
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        writeJson(response, 413, { code: 'publish_payload_too_large' })
        return
      }
      if (error instanceof KeryxAuthenticationError) {
        writeJson(response, error.status, { code: error.code })
        return
      }
      if (error instanceof SyntaxError || error instanceof TypeError) {
        writeJson(response, 422, { code: 'publish_payload_invalid' })
        return
      }
      writeJson(response, 503, { code: 'publish_unavailable' })
    }
  }

  #receiveBackplane(frame: RedisBackplaneFrame): void {
    if (frame.kind === 'event') {
      this.#publishLocal(frame.message)
      return
    }
    this.#broadcastPresenceLocal(
      frame.sourceConnectionId,
      destinationKey(frame.channel),
      frame.channel,
      frame.type,
      frame.member,
    )
  }

  async #announcePresence(
    type: 'presence_joined' | 'presence_left',
    channel: BroadcastDestination,
    member: BroadcastConnectionAdmission['actor'],
    sourceConnectionId?: string,
  ): Promise<void> {
    if (this.#options.topology === 'redis') {
      if (!this.#backplane) throw new Error('Keryx Redis backplane is unavailable.')
      await this.#backplane.publish({
        kind: 'presence',
        type,
        channel,
        member,
        ...(sourceConnectionId ? { sourceConnectionId } : {}),
      })
      return
    }
    this.#broadcastPresenceLocal(sourceConnectionId, destinationKey(channel), channel, type, member)
  }

  async #presenceMembers(key: string): Promise<readonly BroadcastConnectionAdmission['actor'][]> {
    if (!this.#backplane) return this.#presenceMembersLocal(key)
    const connection = [...this.#connections].find((candidate) => candidate.subscriptions.has(key))
    if (!connection) return []
    const destination = connection.subscriptions.get(key)!
    const presence = await this.#backplane.joinPresence(
      connection.id,
      destination,
      actorKey(connection.admission.actor),
      connection.admission.actor,
      Date.now() + this.#options.presenceLeaseMilliseconds,
    )
    return presence.members
  }

  #presenceMembersLocal(
    key: string,
    joining?: BroadcastConnectionAdmission['actor'],
  ): readonly BroadcastConnectionAdmission['actor'][] {
    const members = new Map<string, BroadcastConnectionAdmission['actor']>()
    for (const connection of this.#connections) {
      if (connection.subscriptions.has(key))
        members.set(actorKey(connection.admission.actor), connection.admission.actor)
    }
    if (joining) members.set(actorKey(joining), joining)
    return [...members.values()]
  }

  #hasPresenceMember(key: string, actor: BroadcastConnectionAdmission['actor']): boolean {
    const member = actorKey(actor)
    for (const connection of this.#connections) {
      if (connection.subscriptions.has(key) && actorKey(connection.admission.actor) === member)
        return true
    }
    return false
  }

  #broadcastPresenceLocal(
    sourceConnectionId: string | undefined,
    key: string,
    destination: BroadcastDestination,
    type: 'presence_joined' | 'presence_left',
    member: BroadcastConnectionAdmission['actor'],
  ): void {
    for (const connection of this.#connections) {
      if (connection.id !== sourceConnectionId && connection.subscriptions.has(key))
        this.#send(connection.socket, {
          protocol: KERYX_PROTOCOL,
          type,
          channel: destination,
          member,
        })
    }
  }

  async #pulse(): Promise<void> {
    if (this.#pulseRunning) return
    this.#pulseRunning = true
    try {
      const renewals: Promise<void>[] = []
      for (const connection of this.#connections) {
        if (!(await this.#validateConnection(connection))) continue
        if (!connection.alive) {
          connection.socket.terminate()
          continue
        }
        connection.alive = false
        try {
          connection.socket.ping()
        } catch {
          connection.socket.terminate()
          continue
        }
        const backplane = this.#backplane
        if (backplane)
          for (const destination of connection.subscriptions.values())
            if (destination.kind === 'presence')
              renewals.push(
                backplane
                  .renewPresence(
                    connection.id,
                    destination,
                    Date.now() + this.#options.presenceLeaseMilliseconds,
                  )
                  .catch(() => this.#backplaneUnavailable()),
              )
      }
      await Promise.all(renewals)
      if (this.#backplane) {
        const expired = await this.#backplane.cleanupExpired(Date.now()).catch(() => {
          this.#backplaneUnavailable()
          return []
        })
        for (const entry of expired)
          for (const member of entry.members)
            await this.#announcePresence('presence_left', entry.destination, member).catch(
              () => undefined,
            )
      }
    } finally {
      this.#pulseRunning = false
    }
  }

  async #validateConnection(connection: Connection): Promise<boolean> {
    if (this.#impersonationExpired(connection)) {
      connection.socket.close(4401, 'Authentication expired')
      return false
    }
    try {
      if (
        connection.admission.delegation?.length &&
        (await this.#gateway?.validate?.(connection.admission)) === false
      ) {
        connection.socket.close(4401, 'Authentication revoked')
        return false
      }
      return true
    } catch {
      connection.socket.close(1012, 'Authentication validation unavailable')
      return false
    }
  }

  #impersonationExpired(connection: Connection): boolean {
    return (connection.admission.delegation ?? []).some(
      (hop) => hop.expiresAt !== undefined && hop.expiresAt.getTime() <= Date.now(),
    )
  }

  #backplaneUnavailable(): void {
    if (this.#backplaneRecovery || this.#draining) return
    const stale = this.#backplane
    if (!stale) return
    stale.markUnavailable()
    this.#backplane = undefined
    this.#ready = false
    for (const connection of this.#connections)
      connection.socket.close(1012, 'Keryx backplane unavailable')
    this.#backplaneRecovery = this.#recoverBackplane(stale).finally(() => {
      this.#backplaneRecovery = undefined
    })
  }

  async #recoverBackplane(stale: RedisBackplane): Promise<void> {
    await stale.stop().catch(() => undefined)
    let attempt = 0
    while (!this.#draining && this.#server?.listening) {
      const maximumDelay = Math.min(5_000, 100 * 2 ** Math.min(attempt++, 6))
      await delay(Math.round(maximumDelay * (0.75 + Math.random() * 0.5)))
      if (this.#draining || !this.#server?.listening) return
      const candidate = this.#createBackplane()
      try {
        await candidate.start()
        this.#backplane = candidate
        this.#ready = true
        return
      } catch {
        await candidate.stop().catch(() => undefined)
      }
    }
  }

  #createBackplane(): RedisBackplane {
    return new RedisBackplane(
      this.#options.redisUrl!,
      this.#options.applicationId,
      (frame) => this.#receiveBackplane(frame),
      () => this.#backplaneUnavailable(),
    )
  }

  #reject(connection: Connection, error: KeryxProtocolError): void {
    this.#sendError(connection.socket, error)
    if (error.fatal) connection.socket.close(4400, error.code)
  }

  #sendError(socket: WebSocket, error: KeryxProtocolError): void {
    this.#send(socket, {
      protocol: KERYX_PROTOCOL,
      type: 'error',
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      fatal: error.fatal,
      operation: error.operation,
      ...(error.channel ? { channel: error.channel } : {}),
    })
  }

  #send(socket: WebSocket, frame: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
  }

  #publishPath(): string {
    return `/apps/${encodeURIComponent(this.#options.applicationId)}/events`
  }
}

class PayloadTooLargeError extends Error {}

async function readBody(request: IncomingMessage, maximumBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maximumBytes) throw new PayloadTooLargeError()
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function requestHeaders(incoming: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }
  return headers
}

function requestFromIncoming(incoming: IncomingMessage): Request {
  return new Request(`http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`, {
    headers: requestHeaders(incoming),
  })
}

function admissionTicketFromIncoming(incoming: IncomingMessage): string | undefined {
  const tickets = (incoming.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol.startsWith(KERYX_TICKET_SUBPROTOCOL_PREFIX))
  if (tickets.length === 0) return undefined
  if (tickets.length !== 1)
    throw new KeryxAuthenticationError(
      'admission_ticket_invalid',
      401,
      'Keryx admission credentials are invalid.',
    )
  const ticket = tickets[0]!.slice(KERYX_TICKET_SUBPROTOCOL_PREFIX.length)
  if (!ticket)
    throw new KeryxAuthenticationError(
      'admission_ticket_invalid',
      401,
      'Keryx admission credentials are invalid.',
    )
  return ticket
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response
    .writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    .end(JSON.stringify(body))
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
