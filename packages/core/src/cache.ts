import type { JsonValue } from './index.js'

export interface CachePutOptions {
  readonly ttlSeconds?: number
}

/** Application-owned cache contract. Implementations must honor TTL and atomic add/increment. */
export abstract class Cache {
  abstract get<Value extends JsonValue>(key: string): Promise<Value | undefined>
  abstract put<Value extends JsonValue>(
    key: string,
    value: Value,
    options?: CachePutOptions,
  ): Promise<void>
  abstract add<Value extends JsonValue>(
    key: string,
    value: Value,
    options?: CachePutOptions,
  ): Promise<boolean>
  abstract increment(key: string, amount?: number, options?: CachePutOptions): Promise<number>
  abstract forget(key: string): Promise<boolean>

  async remember<Value extends JsonValue>(
    key: string,
    produce: () => Value | Promise<Value>,
    options?: CachePutOptions,
  ): Promise<Value> {
    const existing = await this.get<Value>(key)
    if (existing !== undefined) return existing
    const value = await produce()
    await this.put(key, value, options)
    return value
  }
}

/** Deterministic local implementation for development and tests. */
export class MemoryCache extends Cache {
  readonly #entries = new Map<string, { value: JsonValue; expiresAt?: number }>()

  constructor(private readonly now: () => number = Date.now) {
    super()
  }

  async get<Value extends JsonValue>(key: string): Promise<Value | undefined> {
    const entry = this.#liveEntry(key)
    if (!entry) return undefined
    return structuredClone(entry.value) as Value
  }

  async put<Value extends JsonValue>(
    key: string,
    value: Value,
    options?: CachePutOptions,
  ): Promise<void> {
    this.#entries.set(key, { value: structuredClone(value), ...expiry(options, this.now()) })
  }

  async add<Value extends JsonValue>(
    key: string,
    value: Value,
    options?: CachePutOptions,
  ): Promise<boolean> {
    if (this.#liveEntry(key)) return false
    this.#entries.set(key, { value: structuredClone(value), ...expiry(options, this.now()) })
    return true
  }

  async increment(key: string, amount = 1, options?: CachePutOptions): Promise<number> {
    const entry = this.#liveEntry(key)
    const current = entry?.value
    if (current !== undefined && typeof current !== 'number') {
      throw new TypeError(`Cache value ${key} is not numeric.`)
    }
    const value = (current ?? 0) + amount
    this.#entries.set(key, {
      value,
      ...(entry
        ? entry.expiresAt === undefined
          ? {}
          : { expiresAt: entry.expiresAt }
        : expiry(options, this.now())),
    })
    return value
  }

  async forget(key: string): Promise<boolean> {
    return this.#entries.delete(key)
  }

  #liveEntry(key: string): { value: JsonValue; expiresAt?: number } | undefined {
    const entry = this.#entries.get(key)
    if (entry?.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.#entries.delete(key)
      return undefined
    }
    return entry
  }
}

function expiry(options: CachePutOptions | undefined, now: number): { expiresAt?: number } {
  if (options?.ttlSeconds === undefined) return {}
  if (!Number.isFinite(options.ttlSeconds) || options.ttlSeconds <= 0) {
    throw new TypeError('Cache ttlSeconds must be a positive finite number.')
  }
  return { expiresAt: now + options.ttlSeconds * 1_000 }
}
