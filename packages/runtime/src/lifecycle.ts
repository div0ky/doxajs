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

import {
  LifecycleCleanupTimeoutError,
  LifecycleTimeoutError,
  RuntimeIntegrityError,
  type UnsettledLifecyclePhase,
} from './errors.js'

type LifecycleSettlement =
  { readonly status: 'fulfilled' } | { readonly status: 'rejected'; readonly reason: unknown }

const TIMEOUT_SETTLEMENTS = new WeakMap<LifecycleTimeoutError, Promise<LifecycleSettlement>>()

export interface LifecycleDeadlines {
  readonly start: number
  readonly drain: number
  readonly stop: number
  readonly dispose: number
  readonly cleanup: number
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
  pendingStartup?: {
    readonly participant: LifecycleParticipant
    readonly error: LifecycleTimeoutError
  },
): Promise<readonly unknown[]> {
  const cleanupDeadlineMilliseconds = Date.now() + deadlines.cleanup
  const cleanupDeadline = Instant.fromEpochMicroseconds(
    BigInt(cleanupDeadlineMilliseconds) * 1_000n,
  )
  const errors: unknown[] = []
  const completed = [...started]

  if (pendingStartup) {
    const settlement = TIMEOUT_SETTLEMENTS.get(pendingStartup.error)
    const result = settlement
      ? await settleWithinCleanupBudget(settlement, cleanupDeadlineMilliseconds)
      : undefined
    if (!result) {
      errors.push(
        new LifecycleCleanupTimeoutError(
          cleanupDeadline,
          pendingCleanupPhases(completed, pendingStartup.participant),
        ),
      )
      return errors
    }
    if (result.status === 'fulfilled') completed.push(pendingStartup.participant)
    else errors.push(result.reason)
  }

  const reverse = completed.reverse()
  const phases = [
    { phase: 'stop' as const, timeout: deadlines.stop },
    { phase: 'dispose' as const, timeout: deadlines.dispose },
  ]
  for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
    const current = phases[phaseIndex]!
    for (let participantIndex = 0; participantIndex < reverse.length; participantIndex += 1) {
      const participant = reverse[participantIndex]!
      if (!participant.manifest.lifecycle[current.phase]) continue
      const remaining = cleanupDeadlineMilliseconds - Date.now()
      if (remaining <= 0) {
        errors.push(
          new LifecycleCleanupTimeoutError(
            cleanupDeadline,
            remainingCleanupPhases(reverse, phases, phaseIndex, participantIndex),
          ),
        )
        return errors
      }
      try {
        await invokeLifecycle(participant, current.phase, Math.min(current.timeout, remaining))
      } catch (error) {
        errors.push(error)
        if (Date.now() >= cleanupDeadlineMilliseconds) {
          errors.push(
            new LifecycleCleanupTimeoutError(
              cleanupDeadline,
              remainingCleanupPhases(reverse, phases, phaseIndex, participantIndex),
            ),
          )
          return errors
        }
      }
    }
  }
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
  const startedAtMilliseconds = Date.now()
  const startedAt = Instant.fromEpochMicroseconds(BigInt(startedAtMilliseconds) * 1_000n)
  const deadline = Instant.fromEpochMicroseconds(BigInt(startedAtMilliseconds + timeout) * 1_000n)
  const context: LifecycleContext = { signal: controller.signal, deadline }
  let timer: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      const timeoutError = new LifecycleTimeoutError(
        participant.manifest.id,
        phase,
        startedAt,
        deadline,
        Date.now() - startedAtMilliseconds,
      )
      reject(timeoutError)
    }, timeout)
    timer.unref()
  })
  const settlement: Promise<LifecycleSettlement> = Promise.resolve()
    .then(() => method.call(participant.instance, context))
    .then(
      () => ({ status: 'fulfilled' as const }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    )
  try {
    const result = await Promise.race([settlement, timeoutPromise])
    if (result.status === 'rejected') throw result.reason
  } catch (error) {
    if (error instanceof LifecycleTimeoutError) {
      TIMEOUT_SETTLEMENTS.set(error, settlement)
    }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function settleWithinCleanupBudget(
  settlement: Promise<LifecycleSettlement>,
  deadlineMilliseconds: number,
): Promise<LifecycleSettlement | undefined> {
  const remaining = deadlineMilliseconds - Date.now()
  if (remaining <= 0) return undefined
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      settlement,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), remaining)
        timer.unref()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function pendingCleanupPhases(
  started: readonly LifecycleParticipant[],
  pending: LifecycleParticipant,
): readonly UnsettledLifecyclePhase[] {
  return [
    { participantId: pending.manifest.id, phase: 'start' },
    ...remainingCleanupPhases(
      [...started].reverse(),
      [
        { phase: 'stop' as const, timeout: 0 },
        { phase: 'dispose' as const, timeout: 0 },
      ],
      0,
      0,
    ),
  ]
}

function remainingCleanupPhases(
  participants: readonly LifecycleParticipant[],
  phases: readonly {
    readonly phase: 'stop' | 'dispose'
    readonly timeout: number
  }[],
  phaseIndex: number,
  participantIndex: number,
): readonly UnsettledLifecyclePhase[] {
  const unsettled: UnsettledLifecyclePhase[] = []
  for (let nextPhaseIndex = phaseIndex; nextPhaseIndex < phases.length; nextPhaseIndex += 1) {
    const phase = phases[nextPhaseIndex]!.phase
    const firstParticipant = nextPhaseIndex === phaseIndex ? participantIndex : 0
    for (let index = firstParticipant; index < participants.length; index += 1) {
      const participant = participants[index]!
      if (participant.manifest.lifecycle[phase]) {
        unsettled.push({ participantId: participant.manifest.id, phase })
      }
    }
  }
  return unsettled
}
