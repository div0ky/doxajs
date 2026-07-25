const PROTOCOL = 2

export type RealtimeEventMap = Readonly<Record<string, unknown>>
export type RealtimeChannelKind = 'public' | 'private' | 'presence'
export type RealtimeConnectionState =
  'idle' | 'connecting' | 'transport-open' | 'authenticated' | 'reconnecting' | 'disconnected'
export type RealtimeSubscriptionState =
  'pending' | 'subscribing' | 'subscribed' | 'failed' | 'leaving' | 'left'

export interface RealtimeError {
  readonly scope: 'connection' | 'subscription' | 'protocol'
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly fatal: boolean
  readonly operation?: 'connect' | 'subscribe' | 'unsubscribe' | 'receive'
  readonly channel?: {
    readonly name: string
    readonly kind: RealtimeChannelKind
  }
}

export interface RealtimeSocket {
  readonly readyState: number
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { readonly data: unknown }) => void) | null
  onclose:
    | ((event: {
        readonly code?: number
        readonly reason?: string
        readonly wasClean?: boolean
      }) => void)
    | null
  onerror: ((event: unknown) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type RealtimeSocketFactory = (
  url: string,
  protocols?: string | readonly string[],
) => RealtimeSocket

export interface RealtimeOptions {
  readonly url: string
  readonly protocols?: string | readonly string[]
  readonly socketFactory?: RealtimeSocketFactory
  readonly reconnect?: boolean
  readonly reconnectMinimumMilliseconds?: number
  readonly reconnectMaximumMilliseconds?: number
  readonly connectionTimeoutMilliseconds?: number
  readonly subscriptionTimeoutMilliseconds?: number
}

export type RealtimeListener = (data: unknown, frame: RealtimeEventFrame) => void
export type RealtimeMember = Readonly<{ kind: string; id?: string }>

export interface RealtimeEventFrame {
  readonly protocol: 2
  readonly type: 'event'
  readonly id: string
  readonly event: string
  readonly channel: { readonly name: string; readonly kind: RealtimeChannelKind }
  readonly data: unknown
  readonly occurredAt: string
}

type StateListener<State extends string> = (state: State) => void
type ErrorListener = (error: RealtimeError) => void

export class Subscription<Events extends RealtimeEventMap = RealtimeEventMap> {
  readonly #listeners = new Map<string, Set<RealtimeListener>>()
  readonly #here = new Set<(members: readonly RealtimeMember[]) => void>()
  readonly #joining = new Set<(member: RealtimeMember) => void>()
  readonly #leaving = new Set<(member: RealtimeMember) => void>()
  readonly #stateListeners = new Set<StateListener<RealtimeSubscriptionState>>()
  readonly #errorListeners = new Set<ErrorListener>()
  #state: RealtimeSubscriptionState = 'pending'
  #lastError: RealtimeError | undefined

  constructor(
    private readonly owner: Realtime,
    readonly name: string,
    readonly kind: RealtimeChannelKind,
  ) {}

  get state(): RealtimeSubscriptionState {
    return this.#state
  }

  get lastError(): RealtimeError | undefined {
    return this.#lastError
  }

  onStateChange(listener: StateListener<RealtimeSubscriptionState>): () => void {
    this.#stateListeners.add(listener)
    return () => this.#stateListeners.delete(listener)
  }

  onError(listener: ErrorListener): () => void {
    this.#errorListeners.add(listener)
    return () => this.#errorListeners.delete(listener)
  }

  listen<Name extends keyof Events & string>(
    event: Name,
    listener: (data: Events[Name], frame: RealtimeEventFrame) => void,
  ): this {
    const listeners = this.#listeners.get(event) ?? new Set<RealtimeListener>()
    listeners.add(listener as RealtimeListener)
    this.#listeners.set(event, listeners)
    return this
  }

  stopListening<Name extends keyof Events & string>(
    event: Name,
    listener?: RealtimeListener,
  ): this {
    if (listener) this.#listeners.get(event)?.delete(listener)
    else this.#listeners.delete(event)
    if (
      [...this.#listeners.values()].every((listeners) => listeners.size === 0) &&
      this.#here.size === 0 &&
      this.#joining.size === 0 &&
      this.#leaving.size === 0
    )
      this.leave()
    return this
  }

  here(listener: (members: readonly RealtimeMember[]) => void): this {
    this.#here.add(listener)
    return this
  }

  joining(listener: (member: RealtimeMember) => void): this {
    this.#joining.add(listener)
    return this
  }

  leaving(listener: (member: RealtimeMember) => void): this {
    this.#leaving.add(listener)
    return this
  }

  leave(): void {
    this.owner.leave(this.name, this.kind)
  }

  dispatch(frame: RealtimeEventFrame): void {
    for (const listener of this.#listeners.get(frame.event) ?? []) listener(frame.data, frame)
  }

  presence(type: 'subscribed' | 'presence_joined' | 'presence_left', value: unknown): void {
    if (type === 'subscribed' && Array.isArray(value))
      for (const listener of this.#here) listener(value as RealtimeMember[])
    if (type === 'presence_joined' && isMember(value))
      for (const listener of this.#joining) listener(value)
    if (type === 'presence_left' && isMember(value))
      for (const listener of this.#leaving) listener(value)
  }

  transition(state: RealtimeSubscriptionState): void {
    if (this.#state === state) return
    this.#state = state
    for (const listener of this.#stateListeners) listener(state)
  }

  fail(error: RealtimeError): void {
    this.#lastError = error
    this.transition('failed')
    for (const listener of this.#errorListeners) listener(error)
  }

  reset(): void {
    this.#lastError = undefined
    this.transition('pending')
  }
}

export class Realtime {
  readonly #options: Required<Omit<RealtimeOptions, 'protocols' | 'socketFactory'>> &
    Pick<RealtimeOptions, 'protocols'>
  readonly #factory: RealtimeSocketFactory
  readonly #subscriptions = new Map<string, Subscription<any>>()
  readonly #subscriptionTimers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #stateListeners = new Set<StateListener<RealtimeConnectionState>>()
  readonly #errorListeners = new Set<ErrorListener>()
  #socket: RealtimeSocket | undefined
  #attempt = 0
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined
  #connectionTimer: ReturnType<typeof setTimeout> | undefined
  #explicitlyDisconnected = false
  #terminalFailure = false
  #state: RealtimeConnectionState = 'idle'
  #lastError: RealtimeError | undefined

  constructor(options: RealtimeOptions) {
    this.#options = {
      url: options.url,
      ...(options.protocols ? { protocols: options.protocols } : {}),
      reconnect: options.reconnect ?? true,
      reconnectMinimumMilliseconds: options.reconnectMinimumMilliseconds ?? 250,
      reconnectMaximumMilliseconds: options.reconnectMaximumMilliseconds ?? 10_000,
      connectionTimeoutMilliseconds: options.connectionTimeoutMilliseconds ?? 10_000,
      subscriptionTimeoutMilliseconds: options.subscriptionTimeoutMilliseconds ?? 10_000,
    }
    this.#factory = options.socketFactory ?? defaultSocketFactory
  }

  get connectionState(): RealtimeConnectionState {
    return this.#state
  }

  get lastError(): RealtimeError | undefined {
    return this.#lastError
  }

  onConnectionState(listener: StateListener<RealtimeConnectionState>): () => void {
    this.#stateListeners.add(listener)
    return () => this.#stateListeners.delete(listener)
  }

  onError(listener: ErrorListener): () => void {
    this.#errorListeners.add(listener)
    return () => this.#errorListeners.delete(listener)
  }

  connect(): void {
    if (this.#socket && this.#socket.readyState < 2) return
    this.#explicitlyDisconnected = false
    this.#terminalFailure = false
    this.#transition(this.#attempt === 0 ? 'connecting' : 'reconnecting')
    let socket: RealtimeSocket
    try {
      socket = this.#factory(this.#options.url, this.#options.protocols)
    } catch (cause) {
      this.#connectionError('connection_failed', messageOf(cause), true, false, 'connect')
      this.#scheduleReconnect()
      return
    }
    this.#socket = socket
    this.#startConnectionTimeout(socket)
    socket.onopen = () => {
      if (this.#socket !== socket) return
      this.#transition('transport-open')
    }
    socket.onmessage = (event) => {
      if (this.#socket === socket) this.#receive(event.data)
    }
    socket.onerror = () => {
      if (this.#socket !== socket) return
      this.#connectionError(
        'transport_error',
        'The realtime transport reported an error.',
        true,
        false,
        'connect',
      )
    }
    socket.onclose = (event) => {
      if (this.#socket !== socket) return
      this.#socket = undefined
      this.#clearConnectionTimeout()
      this.#clearSubscriptionTimers()
      for (const subscription of this.#subscriptions.values()) {
        if (!['leaving', 'left'].includes(subscription.state)) subscription.reset()
      }
      const authenticationFailure = event.code === 4401 || event.code === 4403
      if (authenticationFailure) {
        this.#terminalFailure = true
        this.#connectionError(
          'authentication_failed',
          event.reason || 'Realtime authentication failed.',
          false,
          true,
          'connect',
        )
      }
      this.#transition('disconnected')
      if (!this.#explicitlyDisconnected && !this.#terminalFailure) this.#scheduleReconnect()
    }
  }

  disconnect(): void {
    this.#explicitlyDisconnected = true
    this.#terminalFailure = false
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = undefined
    this.#clearConnectionTimeout()
    this.#clearSubscriptionTimers()
    this.#socket?.close(1000, 'Client disconnect')
    this.#socket = undefined
    for (const subscription of this.#subscriptions.values()) {
      if (subscription.state !== 'left') subscription.reset()
    }
    this.#transition('disconnected')
  }

  channel<Events extends RealtimeEventMap = RealtimeEventMap>(name: string): Subscription<Events> {
    return this.#channel(name, 'public')
  }

  private<Events extends RealtimeEventMap = RealtimeEventMap>(name: string): Subscription<Events> {
    return this.#channel(name, 'private')
  }

  presence<Events extends RealtimeEventMap = RealtimeEventMap>(name: string): Subscription<Events> {
    return this.#channel(name, 'presence')
  }

  leave(name: string, kind?: RealtimeChannelKind): void {
    for (const [key, subscription] of this.#subscriptions) {
      if (subscription.name !== name || (kind && subscription.kind !== kind)) continue
      this.#clearSubscriptionTimer(key)
      if (this.#state !== 'authenticated') {
        subscription.transition('left')
        this.#subscriptions.delete(key)
        continue
      }
      subscription.transition('leaving')
      this.#send({
        protocol: PROTOCOL,
        type: 'unsubscribe',
        channel: destination(subscription),
      })
      this.#startSubscriptionTimeout(key, subscription, 'unsubscribe')
    }
  }

  #channel<Events extends RealtimeEventMap>(
    name: string,
    kind: RealtimeChannelKind,
  ): Subscription<Events> {
    validateName(name)
    const key = `${kind}:${name}`
    const existing = this.#subscriptions.get(key)
    if (existing) return existing as Subscription<Events>
    const subscription = new Subscription<Events>(this, name, kind)
    this.#subscriptions.set(key, subscription)
    this.connect()
    if (this.#state === 'authenticated') this.#subscribe(key, subscription)
    return subscription
  }

  #subscribe(key: string, subscription: Subscription): void {
    if (subscription.state === 'leaving' || subscription.state === 'left') return
    subscription.transition('subscribing')
    this.#send({ protocol: PROTOCOL, type: 'subscribe', channel: destination(subscription) })
    this.#startSubscriptionTimeout(key, subscription, 'subscribe')
  }

  #send(frame: unknown): void {
    if (this.#socket?.readyState !== 1) return
    try {
      this.#socket.send(JSON.stringify(frame))
    } catch (cause) {
      this.#connectionError('send_failed', messageOf(cause), true, false, 'receive')
      this.#socket.close(4400, 'Send failed')
    }
  }

  #receive(data: unknown): void {
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(String(data)) as Record<string, unknown>
    } catch {
      this.#protocolError('invalid_json', 'Keryx sent malformed JSON.', true)
      return
    }
    if (frame.protocol !== PROTOCOL || typeof frame.type !== 'string') {
      this.#protocolError('unsupported_protocol', `Expected Keryx protocol ${PROTOCOL}.`, true)
      return
    }
    if (frame.type === 'connected') {
      if (typeof frame.connectionId !== 'string') {
        this.#protocolError('invalid_connected', 'Keryx sent an invalid connected frame.', true)
        return
      }
      this.#clearConnectionTimeout()
      this.#attempt = 0
      this.#lastError = undefined
      this.#transition('authenticated')
      for (const [key, subscription] of this.#subscriptions) this.#subscribe(key, subscription)
      return
    }
    if (frame.type === 'error') {
      this.#receiveError(frame)
      return
    }
    if (frame.type === 'event' && isEventFrame(frame)) {
      this.#subscriptions.get(channelKey(frame.channel))?.dispatch(frame)
      return
    }
    if (frame.type === 'pong') return
    if (!isChannel(frame.channel)) {
      this.#protocolError('invalid_frame', 'Keryx sent an invalid channel frame.', false)
      return
    }
    const key = channelKey(frame.channel)
    const subscription = this.#subscriptions.get(key)
    if (!subscription) return
    if (frame.type === 'subscribed') {
      this.#clearSubscriptionTimer(key)
      subscription.transition('subscribed')
      subscription.presence('subscribed', frame.members)
      return
    }
    if (frame.type === 'unsubscribed') {
      this.#clearSubscriptionTimer(key)
      subscription.transition('left')
      this.#subscriptions.delete(key)
      return
    }
    if (frame.type === 'presence_joined') {
      subscription.presence('presence_joined', frame.member)
      return
    }
    if (frame.type === 'presence_left') {
      subscription.presence('presence_left', frame.member)
      return
    }
    this.#protocolError('unsupported_frame', `Unsupported Keryx frame ${frame.type}.`, false)
  }

  #receiveError(frame: Record<string, unknown>): void {
    const channel = isChannel(frame.channel) ? frame.channel : undefined
    const error: RealtimeError = Object.freeze({
      scope: channel ? 'subscription' : 'connection',
      code: typeof frame.code === 'string' ? frame.code : 'keryx_error',
      message:
        typeof frame.message === 'string'
          ? frame.message
          : 'Keryx rejected the realtime operation.',
      retryable: frame.retryable === true,
      fatal: frame.fatal === true,
      ...(isOperation(frame.operation) ? { operation: frame.operation } : {}),
      ...(channel ? { channel } : {}),
    })
    if (channel) {
      const key = channelKey(channel)
      this.#clearSubscriptionTimer(key)
      this.#subscriptions.get(key)?.fail(error)
    } else {
      this.#emitConnectionError(error)
    }
    if (error.fatal) {
      this.#terminalFailure = true
      this.#socket?.close(4403, error.code)
    }
  }

  #startConnectionTimeout(socket: RealtimeSocket): void {
    this.#clearConnectionTimeout()
    this.#connectionTimer = setTimeout(() => {
      if (this.#socket !== socket || this.#state === 'authenticated') return
      this.#connectionError(
        'connection_timeout',
        'Keryx did not authenticate the connection before the deadline.',
        true,
        false,
        'connect',
      )
      socket.close(4408, 'Connection timeout')
    }, this.#options.connectionTimeoutMilliseconds)
  }

  #clearConnectionTimeout(): void {
    if (this.#connectionTimer) clearTimeout(this.#connectionTimer)
    this.#connectionTimer = undefined
  }

  #startSubscriptionTimeout(
    key: string,
    subscription: Subscription,
    operation: 'subscribe' | 'unsubscribe',
  ): void {
    this.#clearSubscriptionTimer(key)
    const timer = setTimeout(() => {
      this.#subscriptionTimers.delete(key)
      const error: RealtimeError = Object.freeze({
        scope: 'subscription',
        code: `${operation}_timeout`,
        message: `Keryx did not acknowledge ${operation} before the deadline.`,
        retryable: true,
        fatal: false,
        operation,
        channel: destination(subscription),
      })
      subscription.fail(error)
    }, this.#options.subscriptionTimeoutMilliseconds)
    this.#subscriptionTimers.set(key, timer)
  }

  #clearSubscriptionTimer(key: string): void {
    const timer = this.#subscriptionTimers.get(key)
    if (timer) clearTimeout(timer)
    this.#subscriptionTimers.delete(key)
  }

  #clearSubscriptionTimers(): void {
    for (const timer of this.#subscriptionTimers.values()) clearTimeout(timer)
    this.#subscriptionTimers.clear()
  }

  #connectionError(
    code: string,
    message: string,
    retryable: boolean,
    fatal: boolean,
    operation: RealtimeError['operation'],
  ): void {
    this.#emitConnectionError(
      Object.freeze({
        scope: 'connection',
        code,
        message,
        retryable,
        fatal,
        ...(operation ? { operation } : {}),
      }),
    )
  }

  #protocolError(code: string, message: string, fatal: boolean): void {
    const error: RealtimeError = Object.freeze({
      scope: 'protocol',
      code,
      message,
      retryable: !fatal,
      fatal,
      operation: 'receive',
    })
    this.#emitConnectionError(error)
    if (fatal) {
      this.#terminalFailure = true
      this.#socket?.close(4400, code)
    }
  }

  #emitConnectionError(error: RealtimeError): void {
    this.#lastError = error
    for (const listener of this.#errorListeners) listener(error)
  }

  #transition(state: RealtimeConnectionState): void {
    if (this.#state === state) return
    this.#state = state
    for (const listener of this.#stateListeners) listener(state)
  }

  #scheduleReconnect(): void {
    if (
      this.#reconnectTimer ||
      this.#explicitlyDisconnected ||
      this.#terminalFailure ||
      !this.#options.reconnect
    )
      return
    this.#transition('reconnecting')
    const exponential = Math.min(
      this.#options.reconnectMaximumMilliseconds,
      this.#options.reconnectMinimumMilliseconds * 2 ** this.#attempt++,
    )
    const delay = Math.round(exponential * (0.75 + Math.random() * 0.5))
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined
      this.connect()
    }, delay)
  }
}

function defaultSocketFactory(url: string, protocols?: string | readonly string[]): RealtimeSocket {
  const Constructor = (
    globalThis as unknown as {
      WebSocket?: new (url: string, protocols?: string | readonly string[]) => RealtimeSocket
    }
  ).WebSocket
  if (!Constructor)
    throw new Error('No WebSocket implementation is available; provide socketFactory.')
  return new Constructor(url, protocols)
}

function destination(subscription: Subscription): {
  readonly name: string
  readonly kind: RealtimeChannelKind
} {
  return { name: subscription.name, kind: subscription.kind }
}

function validateName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(name))
    throw new TypeError('Invalid realtime channel name.')
}

function channelKey(channel: {
  readonly name: string
  readonly kind: RealtimeChannelKind
}): string {
  return `${channel.kind}:${channel.name}`
}

function isChannel(
  value: unknown,
): value is { readonly name: string; readonly kind: RealtimeChannelKind } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    ['public', 'private', 'presence'].includes(String((value as { kind?: unknown }).kind))
  )
}

function isMember(value: unknown): value is RealtimeMember {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    ((value as { id?: unknown }).id === undefined ||
      typeof (value as { id?: unknown }).id === 'string')
  )
}

function isEventFrame(
  frame: Record<string, unknown>,
): frame is Record<string, unknown> & RealtimeEventFrame {
  return (
    frame.protocol === PROTOCOL &&
    frame.type === 'event' &&
    typeof frame.id === 'string' &&
    typeof frame.event === 'string' &&
    isChannel(frame.channel) &&
    typeof frame.occurredAt === 'string'
  )
}

function isOperation(value: unknown): value is NonNullable<RealtimeError['operation']> {
  return ['connect', 'subscribe', 'unsubscribe', 'receive'].includes(String(value))
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
