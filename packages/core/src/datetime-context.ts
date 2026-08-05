import { AsyncLocalStorage } from 'node:async_hooks'

export interface DateTimeContext {
  readonly timeZone: string
  readonly locale: string
  now(): bigint
}

const storage = new AsyncLocalStorage<DateTimeContext>()

export function currentDateTimeContext(): DateTimeContext | undefined {
  return storage.getStore()
}

export function requireDateTimeContext(): DateTimeContext {
  const context = currentDateTimeContext()
  if (!context) {
    throw new Error('Clock-relative datetime operations require an active Doxa execution.')
  }
  return context
}

export function runWithDateTimeContext<Output>(
  context: DateTimeContext,
  work: () => Output,
): Output {
  return storage.run(context, work)
}
