import { Duration, Graphite, Instant, LocalDate } from './graphite.js'

export type EncodedDateTimeValue =
  | null
  | boolean
  | number
  | string
  | readonly EncodedDateTimeValue[]
  | { readonly [key: string]: EncodedDateTimeValue }

type DateTimeTag = 'graphite@1' | 'instant@1' | 'local-date@1' | 'duration@1'

function tagged(tag: DateTimeTag, value: string): EncodedDateTimeValue {
  return { $doxa: tag, value }
}

export function encodeDateTimeValues(value: unknown): EncodedDateTimeValue {
  return encode(value, 'tagged')
}

export function encodeDateTimeStrings(value: unknown): EncodedDateTimeValue {
  return encode(value, 'string')
}

function encode(value: unknown, representation: 'tagged' | 'string'): EncodedDateTimeValue {
  if (value instanceof Graphite)
    return representation === 'tagged' ? tagged('graphite@1', value.toString()) : value.toString()
  if (value instanceof Instant)
    return representation === 'tagged' ? tagged('instant@1', value.toString()) : value.toString()
  if (value instanceof LocalDate)
    return representation === 'tagged' ? tagged('local-date@1', value.toString()) : value.toString()
  if (value instanceof Duration)
    return representation === 'tagged' ? tagged('duration@1', value.toString()) : value.toString()
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((entry) => encode(entry, representation))
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Doxa datetime boundaries accept only JSON values and Doxa datetimes.')
    }
    const encoded = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        encode(entry, representation),
      ]),
    )
    return representation === 'tagged' && Object.hasOwn(value, '$doxa')
      ? { $doxa: 'json-object@1', value: encoded }
      : encoded
  }
  throw new TypeError('Doxa datetime boundaries accept only JSON values and Doxa datetimes.')
}

function decodeTagged(value: Record<string, unknown>): unknown {
  if (Object.keys(value).length !== 2) throw new TypeError('Malformed Doxa datetime tag.')
  if (value.$doxa === 'json-object@1') {
    if (!value.value || typeof value.value !== 'object' || Array.isArray(value.value)) {
      throw new TypeError('Malformed Doxa JSON object tag.')
    }
    return Object.fromEntries(
      Object.entries(value.value).map(([key, entry]) => [
        key,
        decodeDateTimeValues(entry as EncodedDateTimeValue),
      ]),
    )
  }
  if (typeof value.value !== 'string') throw new TypeError('Malformed Doxa datetime tag.')
  switch (value.$doxa) {
    case 'graphite@1':
      return Graphite.parse(value.value)
    case 'instant@1':
      return Instant.parse(value.value)
    case 'local-date@1':
      return LocalDate.parse(value.value)
    case 'duration@1':
      return Duration.parse(value.value)
    default:
      throw new TypeError(`Unsupported Doxa datetime tag ${String(value.$doxa)}.`)
  }
}

export function decodeDateTimeValues(value: EncodedDateTimeValue): unknown {
  if (Array.isArray(value)) return value.map(decodeDateTimeValues)
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, '$doxa')) return decodeTagged(value as Record<string, unknown>)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, decodeDateTimeValues(entry)]),
    )
  }
  return value
}
