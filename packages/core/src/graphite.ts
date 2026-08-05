import { currentDateTimeContext, requireDateTimeContext } from './datetime-context.js'

type NativeInstant = Temporal.Instant
type NativeZonedDateTime = Temporal.ZonedDateTime
type NativePlainDate = Temporal.PlainDate
type NativeDuration = Temporal.Duration

export type DateTimeUnit =
  'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond' | 'microsecond'

export type DateTimeDisambiguation = 'compatible' | 'earlier' | 'later' | 'reject'
export type DateTimeRoundingMode =
  | 'ceil'
  | 'floor'
  | 'expand'
  | 'trunc'
  | 'halfCeil'
  | 'halfFloor'
  | 'halfExpand'
  | 'halfTrunc'
  | 'halfEven'

export interface DurationFields {
  readonly years?: number
  readonly months?: number
  readonly weeks?: number
  readonly days?: number
  readonly hours?: number
  readonly minutes?: number
  readonly seconds?: number
  readonly milliseconds?: number
  readonly microseconds?: number
}

export type DurationInput = Duration | DurationFields | string

export interface GraphiteLocalFields {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour?: number
  readonly minute?: number
  readonly second?: number
  readonly millisecond?: number
  readonly microsecond?: number
}

export interface GraphiteFromLocalOptions {
  readonly timeZone: string
  readonly disambiguation?: DateTimeDisambiguation
}

export interface GraphiteFields {
  readonly year?: number
  readonly month?: number
  readonly day?: number
  readonly hour?: number
  readonly minute?: number
  readonly second?: number
  readonly millisecond?: number
  readonly microsecond?: number
}

export interface GraphiteRoundOptions {
  readonly smallestUnit: Exclude<DateTimeUnit, 'year' | 'month' | 'week'>
  readonly roundingIncrement?: number
  readonly roundingMode?: DateTimeRoundingMode
}

export type GraphiteFormatPreset = 'date' | 'time' | 'datetime' | 'full'

export class DateTimeError extends Error {
  override readonly name = 'DateTimeError'
}

function temporal(): typeof Temporal {
  const value = (globalThis as { Temporal?: typeof Temporal }).Temporal
  if (!value)
    throw new DateTimeError('Native Temporal is unavailable. Doxa requires Node 26 or newer.')
  return value
}

function invalid(kind: string, value: unknown, cause?: unknown): DateTimeError {
  return new DateTimeError(`Invalid ${kind}: ${String(value)}`, { cause })
}

function assertMicrosecondEpoch(value: NativeInstant | NativeZonedDateTime): void {
  if (value.epochNanoseconds % 1_000n !== 0n) {
    throw new DateTimeError(
      'Doxa datetimes support microsecond precision; finer precision is invalid.',
    )
  }
}

function assertFractionPrecision(value: string, kind: string): void {
  const fraction = value.match(/\.(\d+)/)?.[1]
  if (fraction && fraction.length > 6) {
    throw new DateTimeError(`${kind} supports at most six fractional-second digits.`)
  }
}

function assertIanaTimeZone(value: string): void {
  if (/^[+-]/u.test(value)) throw invalid('time zone', value)
}

function nativeDuration(value: DurationInput): NativeDuration {
  const serialized = value instanceof Duration ? value.toString() : value
  try {
    const result = temporal().Duration.from(serialized)
    if (result.nanoseconds !== 0) {
      throw new DateTimeError(
        'Doxa durations support microsecond precision; nanoseconds are invalid.',
      )
    }
    return result
  } catch (error) {
    if (error instanceof DateTimeError) throw error
    throw invalid('duration', value, error)
  }
}

function epochNanoseconds(value: Graphite | Instant): bigint {
  return value instanceof Graphite
    ? value.epochMicroseconds * 1_000n
    : value.epochMicroseconds * 1_000n
}

function resolveLocale(locale?: string): string {
  if (locale) return locale
  const context = currentDateTimeContext()
  if (!context) {
    throw new DateTimeError(
      'Locale-relative datetime operations require an active Doxa execution or explicit locale.',
    )
  }
  return context.locale
}

function formatOptions(preset: GraphiteFormatPreset): Intl.DateTimeFormatOptions {
  switch (preset) {
    case 'date':
      return { dateStyle: 'medium' }
    case 'time':
      return { timeStyle: 'medium' }
    case 'datetime':
      return { dateStyle: 'medium', timeStyle: 'medium' }
    case 'full':
      return { dateStyle: 'full', timeStyle: 'long' }
  }
}

function plural<Unit extends DateTimeUnit>(unit: Unit): Temporal.PluralizeUnit<Unit> {
  return `${unit}s` as Temporal.PluralizeUnit<Unit>
}

export class Instant {
  private constructor(private readonly value: NativeInstant) {
    assertMicrosecondEpoch(value)
    Object.freeze(this)
  }

  static now(): Instant {
    return Instant.fromEpochNanoseconds(requireDateTimeContext().now())
  }

  static parse(value: string): Instant {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      throw invalid('instant', value)
    }
    assertFractionPrecision(value, 'Instant')
    try {
      return new Instant(temporal().Instant.from(value))
    } catch (error) {
      if (error instanceof DateTimeError) throw error
      throw invalid('instant', value, error)
    }
  }

  static fromEpochMicroseconds(value: bigint): Instant {
    return Instant.fromEpochNanoseconds(value * 1_000n)
  }

  static fromEpochNanoseconds(value: bigint): Instant {
    if (value % 1_000n !== 0n) {
      throw new DateTimeError(
        'Doxa datetimes support microsecond precision; finer precision is invalid.',
      )
    }
    return new Instant(temporal().Instant.fromEpochNanoseconds(value))
  }

  static fromLegacyDate(value: Date): Instant {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
      throw invalid('legacy Date', value)
    return Instant.fromEpochMicroseconds(BigInt(value.getTime()) * 1_000n)
  }

  get epochMicroseconds(): bigint {
    return this.value.epochNanoseconds / 1_000n
  }

  add(duration: DurationInput): Instant {
    return new Instant(this.value.add(nativeDuration(duration)))
  }

  subtract(duration: DurationInput): Instant {
    return new Instant(this.value.subtract(nativeDuration(duration)))
  }

  equals(other: Instant | Graphite): boolean {
    return epochNanoseconds(this) === epochNanoseconds(other)
  }

  isBefore(other: Instant | Graphite): boolean {
    return epochNanoseconds(this) < epochNanoseconds(other)
  }

  isAfter(other: Instant | Graphite): boolean {
    return epochNanoseconds(this) > epochNanoseconds(other)
  }

  isPast(reference: Instant | Graphite = Instant.now()): boolean {
    return this.isBefore(reference)
  }

  isFuture(reference: Instant | Graphite = Instant.now()): boolean {
    return this.isAfter(reference)
  }

  inTimeZone(timeZone: string): Graphite {
    return Graphite.fromInstant(this, timeZone)
  }

  toLegacyDate(): Date {
    if (this.epochMicroseconds % 1_000n !== 0n) {
      throw new DateTimeError('JavaScript Date cannot represent sub-millisecond precision.')
    }
    return new Date(Number(this.epochMicroseconds / 1_000n))
  }

  toString(): string {
    return this.value.toString({ fractionalSecondDigits: 6 })
  }

  toJSON(): string {
    return this.toString()
  }
}

export class Graphite {
  private constructor(private readonly value: NativeZonedDateTime) {
    assertMicrosecondEpoch(value)
    Object.freeze(this)
  }

  static now(timeZone?: string): Graphite {
    const context = requireDateTimeContext()
    return Graphite.fromInstant(
      Instant.fromEpochNanoseconds(context.now()),
      timeZone ?? context.timeZone,
    )
  }

  static parse(value: string): Graphite {
    const match = value.match(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\[([^\]]+)\]$/,
    )
    if (!match) throw invalid('Graphite datetime', value)
    assertIanaTimeZone(match[1]!)
    assertFractionPrecision(value, 'Graphite')
    try {
      return new Graphite(
        temporal().ZonedDateTime.from(value, { offset: 'reject', disambiguation: 'reject' }),
      )
    } catch (error) {
      if (error instanceof DateTimeError) throw error
      throw invalid('Graphite datetime', value, error)
    }
  }

  static fromInstant(value: Instant | string, timeZone = 'UTC'): Graphite {
    const instant = typeof value === 'string' ? Instant.parse(value) : value
    assertIanaTimeZone(timeZone)
    try {
      return new Graphite(
        temporal()
          .Instant.fromEpochNanoseconds(instant.epochMicroseconds * 1_000n)
          .toZonedDateTimeISO(timeZone),
      )
    } catch (error) {
      if (error instanceof DateTimeError) throw error
      throw invalid('time zone', timeZone, error)
    }
  }

  static fromLegacyDate(value: Date, timeZone = 'UTC'): Graphite {
    return Graphite.fromInstant(Instant.fromLegacyDate(value), timeZone)
  }

  static fromLocal(
    value: string | GraphiteLocalFields,
    options: GraphiteFromLocalOptions,
  ): Graphite {
    assertIanaTimeZone(options.timeZone)
    if (typeof value === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) {
        throw invalid('local datetime', value)
      }
      assertFractionPrecision(value, 'Local datetime')
    }
    try {
      const local = temporal().PlainDateTime.from(value)
      return new Graphite(
        temporal().ZonedDateTime.from(
          {
            year: local.year,
            month: local.month,
            day: local.day,
            hour: local.hour,
            minute: local.minute,
            second: local.second,
            millisecond: local.millisecond,
            microsecond: local.microsecond,
            nanosecond: local.nanosecond,
            timeZone: options.timeZone,
          },
          { disambiguation: options.disambiguation ?? 'reject' },
        ),
      )
    } catch (error) {
      if (error instanceof DateTimeError) throw error
      throw invalid(
        'local datetime',
        typeof value === 'string' ? value : JSON.stringify(value),
        error,
      )
    }
  }

  get epochMicroseconds(): bigint {
    return this.value.epochNanoseconds / 1_000n
  }

  get timeZone(): string {
    return this.value.timeZoneId
  }

  get offset(): string {
    return this.value.offset
  }

  get year(): number {
    return this.value.year
  }

  get month(): number {
    return this.value.month
  }

  get day(): number {
    return this.value.day
  }

  get hour(): number {
    return this.value.hour
  }

  get minute(): number {
    return this.value.minute
  }

  get second(): number {
    return this.value.second
  }

  with(fields: GraphiteFields, disambiguation: DateTimeDisambiguation = 'reject'): Graphite {
    try {
      return new Graphite(
        this.value.with(fields, { disambiguation, offset: 'reject', overflow: 'reject' }),
      )
    } catch (error) {
      throw invalid('Graphite fields', JSON.stringify(fields), error)
    }
  }

  add(duration: DurationInput): Graphite {
    return new Graphite(this.value.add(nativeDuration(duration)))
  }

  subtract(duration: DurationInput): Graphite {
    return new Graphite(this.value.subtract(nativeDuration(duration)))
  }

  startOf(unit: DateTimeUnit): Graphite {
    switch (unit) {
      case 'year':
        return this.with(
          { month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0, microsecond: 0 },
          'compatible',
        )
      case 'month':
        return this.with(
          { day: 1, hour: 0, minute: 0, second: 0, millisecond: 0, microsecond: 0 },
          'compatible',
        )
      case 'week':
        return this.startOf('day').subtract({ days: this.value.dayOfWeek - 1 })
      case 'day':
        return new Graphite(this.value.startOfDay())
      case 'hour':
        return this.with({ minute: 0, second: 0, millisecond: 0, microsecond: 0 }, 'compatible')
      case 'minute':
        return this.with({ second: 0, millisecond: 0, microsecond: 0 }, 'compatible')
      case 'second':
        return this.with({ millisecond: 0, microsecond: 0 }, 'compatible')
      case 'millisecond':
        return this.with({ microsecond: 0 }, 'compatible')
      case 'microsecond':
        return this
    }
  }

  endOf(unit: DateTimeUnit): Graphite {
    if (unit === 'microsecond') return this
    return this.startOf(unit)
      .add({ [plural(unit)]: 1 } as DurationFields)
      .subtract({ microseconds: 1 })
  }

  round(options: GraphiteRoundOptions | GraphiteRoundOptions['smallestUnit']): Graphite {
    if (typeof options === 'string') return new Graphite(this.value.round(plural(options)))
    return new Graphite(
      this.value.round({ ...options, smallestUnit: plural(options.smallestUnit) }),
    )
  }

  inTimeZone(timeZone: string): Graphite {
    try {
      return new Graphite(this.value.withTimeZone(timeZone))
    } catch (error) {
      throw invalid('time zone', timeZone, error)
    }
  }

  equals(other: Graphite): boolean {
    return this.timeZone === other.timeZone && this.sameInstant(other)
  }

  sameInstant(other: Graphite | Instant): boolean {
    return epochNanoseconds(this) === epochNanoseconds(other)
  }

  isBefore(other: Graphite | Instant): boolean {
    return epochNanoseconds(this) < epochNanoseconds(other)
  }

  isAfter(other: Graphite | Instant): boolean {
    return epochNanoseconds(this) > epochNanoseconds(other)
  }

  isBetween(
    start: Graphite | Instant,
    end: Graphite | Instant,
    options: { readonly inclusive?: boolean } = {},
  ): boolean {
    const value = epochNanoseconds(this)
    const lower = epochNanoseconds(start)
    const upper = epochNanoseconds(end)
    return options.inclusive ? value >= lower && value <= upper : value > lower && value < upper
  }

  isPast(reference: Graphite | Instant = Instant.now()): boolean {
    return this.isBefore(reference)
  }

  isFuture(reference: Graphite | Instant = Instant.now()): boolean {
    return this.isAfter(reference)
  }

  isToday(reference: Graphite = Graphite.now(this.timeZone)): boolean {
    return this.toLocalDate().equals(reference.inTimeZone(this.timeZone).toLocalDate())
  }

  isTomorrow(reference: Graphite = Graphite.now(this.timeZone)): boolean {
    return this.toLocalDate().equals(
      reference.inTimeZone(this.timeZone).toLocalDate().add({ days: 1 }),
    )
  }

  isYesterday(reference: Graphite = Graphite.now(this.timeZone)): boolean {
    return this.toLocalDate().equals(
      reference.inTimeZone(this.timeZone).toLocalDate().subtract({ days: 1 }),
    )
  }

  isWeekend(locale?: string): boolean {
    const language = new Intl.Locale(resolveLocale(locale)) as Intl.Locale & {
      getWeekInfo(): { readonly weekend: readonly number[] }
    }
    const weekend = language.getWeekInfo().weekend
    return weekend.includes(this.value.dayOfWeek)
  }

  isWeekday(locale?: string): boolean {
    return !this.isWeekend(locale)
  }

  isLeapYear(): boolean {
    return this.value.inLeapYear
  }

  diff(other: Graphite | Instant, largestUnit: DateTimeUnit = 'day'): Duration {
    const target = other.inTimeZone(this.timeZone)
    return Duration.parse(
      this.value.until(target.value, { largestUnit: plural(largestUnit) }).toString(),
    )
  }

  diffIn(unit: DateTimeUnit, other: Graphite | Instant): number {
    const target = other.inTimeZone(this.timeZone)
    return this.value.until(target.value).total({ unit: plural(unit), relativeTo: this.value })
  }

  diffForHumans(
    other: Graphite | Instant = Instant.now(),
    options: { readonly locale?: string; readonly style?: Intl.RelativeTimeFormatStyle } = {},
  ): string {
    const seconds = Number(epochNanoseconds(this) - epochNanoseconds(other)) / 1_000_000_000
    const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
      ['year', 31_556_952],
      ['month', 2_629_746],
      ['week', 604_800],
      ['day', 86_400],
      ['hour', 3_600],
      ['minute', 60],
      ['second', 1],
    ]
    const [unit, divisor] = units.find(([, size]) => Math.abs(seconds) >= size) ?? units.at(-1)!
    return new Intl.RelativeTimeFormat(resolveLocale(options.locale), {
      numeric: 'auto',
      style: options.style ?? 'long',
    }).format(Math.trunc(seconds / divisor), unit)
  }

  format(
    format: GraphiteFormatPreset | Intl.DateTimeFormatOptions = 'datetime',
    locale?: string,
  ): string {
    const options = typeof format === 'string' ? formatOptions(format) : format
    return new Intl.DateTimeFormat(resolveLocale(locale), {
      ...options,
      timeZone: this.timeZone,
    }).format(new Date(Number(this.value.epochMilliseconds)))
  }

  toInstant(): Instant {
    return Instant.fromEpochMicroseconds(this.epochMicroseconds)
  }

  toLegacyDate(): Date {
    return this.toInstant().toLegacyDate()
  }

  toLocalDate(): LocalDate {
    return LocalDate.parse(this.value.toPlainDate().toString())
  }

  toString(): string {
    return this.value.toString({
      calendarName: 'never',
      fractionalSecondDigits: 6,
      offset: 'auto',
      timeZoneName: 'auto',
    })
  }

  toJSON(): string {
    return this.toString()
  }
}

export class LocalDate {
  private constructor(private readonly value: NativePlainDate) {
    Object.freeze(this)
  }

  static today(timeZone?: string): LocalDate {
    return Graphite.now(timeZone).toLocalDate()
  }

  static parse(value: string): LocalDate {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid('local date', value)
    try {
      const result = temporal().PlainDate.from(value)
      if (result.toString() !== value) throw invalid('local date', value)
      return new LocalDate(result)
    } catch (error) {
      if (error instanceof DateTimeError) throw error
      throw invalid('local date', value, error)
    }
  }

  get year(): number {
    return this.value.year
  }

  get month(): number {
    return this.value.month
  }

  get day(): number {
    return this.value.day
  }

  add(duration: DurationInput): LocalDate {
    return LocalDate.parse(this.value.add(nativeDuration(duration)).toString())
  }

  subtract(duration: DurationInput): LocalDate {
    return LocalDate.parse(this.value.subtract(nativeDuration(duration)).toString())
  }

  equals(other: LocalDate): boolean {
    return this.value.equals(other.value)
  }

  isBefore(other: LocalDate): boolean {
    return temporal().PlainDate.compare(this.value, other.value) < 0
  }

  isAfter(other: LocalDate): boolean {
    return temporal().PlainDate.compare(this.value, other.value) > 0
  }

  diff(
    other: LocalDate,
    largestUnit: Extract<DateTimeUnit, 'year' | 'month' | 'week' | 'day'> = 'day',
  ): Duration {
    return Duration.parse(
      this.value.until(other.value, { largestUnit: plural(largestUnit) }).toString(),
    )
  }

  toString(): string {
    return this.value.toString({ calendarName: 'never' })
  }

  toJSON(): string {
    return this.toString()
  }
}

export class Duration {
  private constructor(private readonly value: NativeDuration) {
    Object.freeze(this)
  }

  static parse(value: string): Duration {
    if (!/^-?P/.test(value)) throw invalid('duration', value)
    assertFractionPrecision(value, 'Duration')
    return new Duration(nativeDuration(value))
  }

  static of(value: DurationFields): Duration {
    return new Duration(nativeDuration(value))
  }

  add(other: DurationInput): Duration {
    return Duration.parse(this.value.add(nativeDuration(other)).toString())
  }

  subtract(other: DurationInput): Duration {
    return Duration.parse(this.value.subtract(nativeDuration(other)).toString())
  }

  negate(): Duration {
    return Duration.parse(this.value.negated().toString())
  }

  abs(): Duration {
    return Duration.parse(this.value.abs().toString())
  }

  total(unit: DateTimeUnit, relativeTo?: Graphite): number {
    return this.value.total(
      relativeTo
        ? { unit: plural(unit), relativeTo: relativeTo.toString() }
        : { unit: plural(unit) },
    )
  }

  toString(): string {
    return this.value.toString()
  }

  toJSON(): string {
    return this.toString()
  }
}
