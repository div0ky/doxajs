import { DateTimeError, Duration, Graphite, Instant, LocalDate } from '@doxajs/core'
import {
  decodeDateTimeValues,
  encodeDateTimeValues,
  runWithDateTimeContext,
} from '@doxajs/core/runtime'
import { duration, graphite, instant, localDate } from '@doxajs/core/zod'
import { describe, expect, it } from 'vitest'

describe('Graphite datetimes', () => {
  it('preserves an instant while changing its presentation time zone', () => {
    const chicago = Graphite.parse('2026-08-05T09:00:00.123456-05:00[America/Chicago]')

    expect(chicago.toString()).toBe('2026-08-05T09:00:00.123456-05:00[America/Chicago]')
    expect(chicago.toInstant().toString()).toBe('2026-08-05T14:00:00.123456Z')
    expect(chicago.inTimeZone('UTC').toString()).toBe('2026-08-05T14:00:00.123456+00:00[UTC]')
    expect(chicago.equals(chicago.inTimeZone('UTC'))).toBe(false)
    expect(chicago.sameInstant(chicago.inTimeZone('UTC'))).toBe(true)
    expect(Object.isFrozen(chicago)).toBe(true)
  })

  it('rejects ambiguity, gaps, mismatched offsets, and excess precision', () => {
    expect(() =>
      Graphite.fromLocal('2026-11-01T01:30:00', { timeZone: 'America/Chicago' }),
    ).toThrow(DateTimeError)
    expect(() =>
      Graphite.fromLocal('2026-03-08T02:30:00', { timeZone: 'America/Chicago' }),
    ).toThrow(DateTimeError)
    expect(() => Graphite.parse('2026-08-05T09:00:00-06:00[America/Chicago]')).toThrow(
      DateTimeError,
    )
    expect(() => Instant.parse('2026-08-05T14:00:00.1234567Z')).toThrow(DateTimeError)

    const earlier = Graphite.fromLocal('2026-11-01T01:30:00', {
      timeZone: 'America/Chicago',
      disambiguation: 'earlier',
    })
    const later = Graphite.fromLocal('2026-11-01T01:30:00', {
      timeZone: 'America/Chicago',
      disambiguation: 'later',
    })
    expect(earlier.offset).toBe('-05:00')
    expect(later.offset).toBe('-06:00')
  })

  it('provides immutable calendar arithmetic and useful comparisons', () => {
    const value = Graphite.parse('2024-02-29T12:45:30.000001-06:00[America/Chicago]')
    const next = value.add({ days: 1, hours: 2 })

    expect(next.toString()).toBe('2024-03-01T14:45:30.000001-06:00[America/Chicago]')
    expect(value.startOf('day').toString()).toBe(
      '2024-02-29T00:00:00.000000-06:00[America/Chicago]',
    )
    expect(value.endOf('day').toString()).toBe('2024-02-29T23:59:59.999999-06:00[America/Chicago]')
    expect(value.isLeapYear()).toBe(true)
    expect(value.isBefore(next)).toBe(true)
    expect(value.isBetween(value.subtract({ seconds: 1 }), next)).toBe(true)
    expect(value.diffIn('hour', next)).toBe(26)
  })

  it('uses only an admitted Doxa clock for relative operations', () => {
    expect(() => Instant.now()).toThrow(
      'Clock-relative datetime operations require an active Doxa execution.',
    )

    const fixed = Instant.parse('2026-08-05T14:00:00Z')
    runWithDateTimeContext(
      {
        timeZone: 'America/Chicago',
        locale: 'en-US',
        now: () => fixed.epochMicroseconds * 1_000n,
      },
      () => {
        expect(Instant.now().equals(fixed)).toBe(true)
        expect(Graphite.now().toString()).toBe('2026-08-05T09:00:00.000000-05:00[America/Chicago]')
        expect(LocalDate.today().toString()).toBe('2026-08-05')
        expect(Graphite.now().isToday()).toBe(true)
        expect(Graphite.now().isWeekday()).toBe(true)
      },
    )
  })

  it('supports strict companion values and Zod codecs', () => {
    const parsedInstant = instant().decode('2026-08-05T14:00:00Z')
    const parsedGraphite = graphite().decode('2026-08-05T09:00:00-05:00[America/Chicago]')
    const parsedDate = localDate().decode('2024-02-29')
    const parsedDuration = duration().decode('P1DT2H0.000001S')

    expect(instant().encode(parsedInstant)).toBe('2026-08-05T14:00:00.000000Z')
    expect(graphite().encode(parsedGraphite)).toBe(
      '2026-08-05T09:00:00.000000-05:00[America/Chicago]',
    )
    expect(parsedDate.add({ years: 1 }).toString()).toBe('2025-02-28')
    expect(parsedDuration.toString()).toBe('P1DT2H0.000001S')
    expect(graphite().safeDecode('not-a-datetime').success).toBe(false)
    expect(() => Duration.parse('PT0.0000001S')).toThrow(DateTimeError)
  })

  it('round-trips trusted durable values through versioned tags', () => {
    const value = {
      startsAt: Graphite.parse('2026-08-05T09:00:00-05:00[America/Chicago]'),
      expiresAt: Instant.parse('2026-08-05T15:00:00Z'),
      dates: [LocalDate.parse('2026-08-05'), Duration.parse('PT1H')],
    }
    const encoded = encodeDateTimeValues(value)
    const decoded = decodeDateTimeValues(encoded) as typeof value

    expect(JSON.parse(JSON.stringify(encoded))).toEqual(encoded)
    expect(decoded.startsAt).toBeInstanceOf(Graphite)
    expect(decoded.startsAt.toString()).toBe(value.startsAt.toString())
    expect(decoded.expiresAt).toBeInstanceOf(Instant)
    expect(decoded.dates[0]).toBeInstanceOf(LocalDate)
    expect(decoded.dates[1]).toBeInstanceOf(Duration)
  })
})
