import { Instant, type LifecycleContext } from '@doxajs/core'
import type {
  CommandManifestEntry,
  JobManifestEntry,
  ListenerManifestEntry,
  ObserverManifestEntry,
  OperationManifestEntry,
  ProviderManifestEntry,
  RouteManifestEntry,
  SignalHandlerManifestEntry,
} from '@doxajs/manifest'

import { RuntimeIntegrityError } from './errors.js'

export interface LifecycleDeadlines {
  readonly start: number
  readonly drain: number
  readonly stop: number
  readonly dispose: number
}

export interface LifecycleParticipant {
  readonly manifest: Pick<
    | ProviderManifestEntry
    | OperationManifestEntry
    | RouteManifestEntry
    | ListenerManifestEntry
    | JobManifestEntry
    | SignalHandlerManifestEntry
    | ObserverManifestEntry
    | CommandManifestEntry,
    'id' | 'lifecycle'
  >
  readonly instance: object
}

export async function unwindStartup(
  started: readonly LifecycleParticipant[],
  deadlines: LifecycleDeadlines,
): Promise<readonly unknown[]> {
  const reverse = [...started].reverse()
  const errors: unknown[] = []
  await invokePhase(reverse, 'stop', deadlines.stop, errors)
  await invokePhase(reverse, 'dispose', deadlines.dispose, errors)
  return errors
}

export async function invokePhase(
  participants: readonly LifecycleParticipant[],
  phase: 'drain' | 'stop' | 'dispose',
  timeout: number,
  errors: unknown[],
): Promise<void> {
  for (const participant of participants) {
    if (!participant.manifest.lifecycle[phase]) continue
    try {
      await invokeLifecycle(participant, phase, timeout)
    } catch (error) {
      errors.push(error)
    }
  }
}

export async function invokeLifecycle(
  participant: LifecycleParticipant,
  phase: 'start' | 'drain' | 'stop' | 'dispose',
  timeout: number,
): Promise<void> {
  const method = (participant.instance as Record<string, unknown>)[phase]
  if (typeof method !== 'function') {
    throw new RuntimeIntegrityError(
      `${participant.manifest.id} declares ${phase} but has no callable method.`,
    )
  }
  const controller = new AbortController()
  const deadline = Instant.fromEpochMicroseconds(BigInt(Date.now() + timeout) * 1_000n)
  const context: LifecycleContext = { signal: controller.signal, deadline }
  let timer: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(
        new Error(`${participant.manifest.id} exceeded its ${phase} deadline of ${timeout}ms.`),
      )
    }, timeout)
    timer.unref()
  })
  try {
    await Promise.race([
      Promise.resolve(method.call(participant.instance, context)),
      timeoutPromise,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
