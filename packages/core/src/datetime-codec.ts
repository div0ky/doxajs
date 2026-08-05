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
  if (value instanceof Graphite) return tagged('graphite@1', value.toString())
  if (value instanceof Instant) return tagged('instant@1', value.toString())
  if (value instanceof LocalDate) return tagged('local-date@1', value.toString())
  if (value instanceof Duration) return tagged('duration@1', value.toString())
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(encodeDateTimeValues)
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Doxa durable values must contain only JSON values and Doxa datetimes.')
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        encodeDateTimeValues(entry),
      ]),
    )
  }
  throw new TypeError('Doxa durable values must contain only JSON values and Doxa datetimes.')
}

function decodeTagged(
  value: Record<string, unknown>,
): Graphite | Instant | LocalDate | Duration | undefined {
  if (Object.keys(value).length !== 2 || typeof value.value !== 'string') return undefined
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
      return undefined
  }
}

export function decodeDateTimeValues(value: EncodedDateTimeValue): unknown {
  if (Array.isArray(value)) return value.map(decodeDateTimeValues)
  if (value && typeof value === 'object') {
    const decoded = decodeTagged(value as Record<string, unknown>)
    if (decoded) return decoded
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, decodeDateTimeValues(entry)]),
    )
  }
  return value
}
