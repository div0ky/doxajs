export interface RecordedJobAttempt {
  readonly jobId: string
  readonly key: string
  readonly attempt: number
  readonly executionId: string
  readonly correlationId: string
  readonly causationId: string | undefined
  readonly actor: string
  readonly actorId: string | undefined
}

export const recordedJobAttempts: RecordedJobAttempt[] = []

export function resetRecordedJobAttempts(): void {
  recordedJobAttempts.length = 0
}
