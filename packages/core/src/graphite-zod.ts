import { z } from 'zod'

import { Duration, Graphite, Instant, LocalDate } from './graphite.js'

function encoded<Value>(name: string, parse: (value: string) => Value, output: z.ZodType<Value>) {
  const input = z.string().superRefine((value, context) => {
    try {
      parse(value)
    } catch {
      context.addIssue({ code: 'custom', message: `Invalid ${name}.` })
    }
  })
  return z.codec(input, output, { decode: parse, encode: (value) => String(value) })
}

export function graphite() {
  return encoded(
    'Graphite datetime',
    Graphite.parse,
    z.custom<Graphite>((value) => value instanceof Graphite),
  )
}

export function instant() {
  return encoded(
    'instant',
    Instant.parse,
    z.custom<Instant>((value) => value instanceof Instant),
  )
}

export function localDate() {
  return encoded(
    'local date',
    LocalDate.parse,
    z.custom<LocalDate>((value) => value instanceof LocalDate),
  )
}

export function duration() {
  return encoded(
    'duration',
    Duration.parse,
    z.custom<Duration>((value) => value instanceof Duration),
  )
}
