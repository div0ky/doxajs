import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication, DoxaCompilationError } from '@doxajs/compiler'
import type { LifecycleContext } from '@doxajs/core'
import {
  Doxa,
  LifecycleCleanupTimeoutError,
  LifecycleTimeoutError,
  RuntimeBootError,
} from '@doxajs/runtime'
import { afterEach, describe, expect, it } from 'vitest'

import { Application } from '../examples/reference-app/dist/application.js'
import { assertManifest } from '../packages/manifest/dist/index.js'

const workspace = path.resolve(import.meta.dirname, '..')
const referenceApplication = path.join(workspace, 'examples/reference-app')
const temporaryDirectories: string[] = []

describe('bug-hunt compiler and lifecycle reproductions', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, {
          recursive: true,
          force: true,
        }),
      ),
    )
  })

  it('fails compilation when distinct configuration declarations produce one stable ID', async () => {
    const root = await temporaryDirectory('.bug-hunt-duplicate-config-', workspace)
    await mkdir(path.join(root, 'src'))
    await writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        extends: path.join(workspace, 'tsconfig.base.json'),
        compilerOptions: {
          composite: false,
          rootDir: 'src',
          outDir: 'dist',
          declaration: false,
          declarationMap: false,
        },
        include: ['src/**/*.ts'],
      }),
    )
    await writeFile(
      path.join(root, 'src/alpha.ts'),
      `import { Configuration } from '@doxajs/core'
export class SharedConfig extends Configuration { value = 'alpha' }
`,
    )
    await writeFile(
      path.join(root, 'src/beta.ts'),
      `import { Configuration } from '@doxajs/core'
export class SharedConfig extends Configuration { value = 'beta' }
`,
    )
    await writeFile(
      path.join(root, 'src/application.ts'),
      `import { DoxaApplication } from '@doxajs/core'
import { SharedConfig as AlphaConfig } from './alpha.js'
import { SharedConfig as BetaConfig } from './beta.js'
export class Application extends DoxaApplication {
  id = 'duplicate-config'
  configs = [AlphaConfig, BetaConfig]
  features = []
}
`,
    )

    await expect(
      compileApplication({
        tsconfigPath: path.join(root, 'tsconfig.json'),
        applicationFile: path.join(root, 'src/application.ts'),
        sourceRoot: path.join(root, 'src'),
        outputRoot: path.join(root, 'dist'),
        artifactsDirectory: path.join(root, '.doxa'),
      }),
    ).rejects.toMatchObject({
      name: DoxaCompilationError.name,
      message: expect.stringMatching(/duplicate .*config/i),
    })
  })

  it('rejects duplicate configuration IDs at the artifact boundary', async () => {
    const artifactsDirectory = await temporaryDirectory('doxa-duplicate-config-manifest-')
    const result = await compileReferenceApplication(artifactsDirectory)
    const manifest = structuredClone(result.manifest) as unknown as {
      configurations: Array<{ id: string }>
    }
    manifest.configurations.push(structuredClone(manifest.configurations[0]!))

    expect(() => assertManifest(manifest)).toThrow('Doxa manifest has duplicate configuration ID')
  })

  it('waits for timed-out startup work and unwinds a participant that finishes late', async () => {
    const artifactsDirectory = await temporaryDirectory('doxa-lifecycle-timeout-')
    await compileReferenceApplication(artifactsDirectory)
    const events: string[] = []
    const participant = {
      async start(context: LifecycleContext): Promise<void> {
        events.push('start')
        await new Promise<void>((resolve) => {
          const finishLate = () => setImmediate(resolve)
          if (context.signal.aborted) finishLate()
          else context.signal.addEventListener('abort', finishLate, { once: true })
        })
        events.push(`started:aborted=${context.signal.aborted}`)
      },
      stop(): void {
        events.push('stop')
      },
      dispose(): void {
        events.push('dispose')
      },
    }
    const temporalDescriptor = installMinimalTemporalIfMissing()

    try {
      const boot = Doxa.boot(Application, {
        artifactsDirectory,
        dotenvPath: false,
        environment: {},
        deadlines: { start: 5, stop: 100, dispose: 100, cleanup: 100 },
        providerOverrides: { 'provider:operations/worker': participant },
      })
      await expect(boot).rejects.toMatchObject({
        name: RuntimeBootError.name,
        primaryError: {
          name: LifecycleTimeoutError.name,
          participantId: 'provider:operations/worker',
          phase: 'start',
          elapsedMs: expect.any(Number),
        },
      })
      expect(events).toEqual(['start', 'started:aborted=true', 'stop', 'dispose'])
    } finally {
      restoreTemporal(temporalDescriptor)
    }
  })

  it('bounds the post-timeout wait when startup never settles', async () => {
    const artifactsDirectory = await temporaryDirectory('doxa-lifecycle-never-settles-')
    await compileReferenceApplication(artifactsDirectory)
    const events: string[] = []
    const participant = {
      async start(): Promise<void> {
        events.push('start')
        await new Promise<void>(() => undefined)
      },
      stop(): void {
        events.push('stop')
      },
      dispose(): void {
        events.push('dispose')
      },
    }
    const temporalDescriptor = installMinimalTemporalIfMissing()
    const startedAt = Date.now()

    try {
      await expect(
        Doxa.boot(Application, {
          artifactsDirectory,
          dotenvPath: false,
          environment: {},
          deadlines: { start: 5, stop: 100, dispose: 100, cleanup: 20 },
          providerOverrides: { 'provider:operations/worker': participant },
        }),
      ).rejects.toMatchObject({
        name: RuntimeBootError.name,
        primaryError: { name: LifecycleTimeoutError.name, phase: 'start' },
        cleanupErrors: expect.arrayContaining([
          expect.objectContaining({
            name: LifecycleCleanupTimeoutError.name,
            deadline: expect.anything(),
            unsettled: expect.arrayContaining([
              {
                participantId: 'provider:operations/worker',
                phase: 'start',
              },
            ]),
          }),
        ]),
      })
      expect(Date.now() - startedAt).toBeLessThan(250)
      expect(events).toEqual(['start'])
    } finally {
      restoreTemporal(temporalDescriptor)
    }
  })

  it('records a post-timeout startup rejection as a secondary cleanup error', async () => {
    const artifactsDirectory = await temporaryDirectory('doxa-lifecycle-late-rejection-')
    await compileReferenceApplication(artifactsDirectory)
    const temporalDescriptor = installMinimalTemporalIfMissing()

    try {
      await expect(
        Doxa.boot(Application, {
          artifactsDirectory,
          dotenvPath: false,
          environment: {},
          deadlines: { start: 5, stop: 100, dispose: 100, cleanup: 100 },
          providerOverrides: {
            'provider:operations/worker': {
              start: (context: LifecycleContext) =>
                new Promise<void>((_resolve, reject) => {
                  context.signal.addEventListener(
                    'abort',
                    () => setImmediate(() => reject(new Error('late startup rejection'))),
                    { once: true },
                  )
                }),
            },
          },
        }),
      ).rejects.toMatchObject({
        name: RuntimeBootError.name,
        primaryError: { name: LifecycleTimeoutError.name, phase: 'start' },
        cleanupErrors: expect.arrayContaining([
          expect.objectContaining({ message: 'late startup rejection' }),
        ]),
      })
    } finally {
      restoreTemporal(temporalDescriptor)
    }
  })

  it('caps stop and disposal by one shared startup-cleanup budget', async () => {
    const artifactsDirectory = await temporaryDirectory('doxa-lifecycle-shared-cleanup-')
    await compileReferenceApplication(artifactsDirectory)
    const events: string[] = []
    const temporalDescriptor = installMinimalTemporalIfMissing()
    const participant = {
      async start(): Promise<void> {
        events.push('start')
        await new Promise((resolve) => setTimeout(resolve, 15))
        events.push('started')
      },
      async stop(): Promise<void> {
        events.push('stop')
        await new Promise<void>(() => undefined)
      },
      dispose(): void {
        events.push('dispose')
      },
    }

    try {
      await expect(
        Doxa.boot(Application, {
          artifactsDirectory,
          dotenvPath: false,
          environment: {},
          deadlines: { start: 5, stop: 100, dispose: 100, cleanup: 40 },
          providerOverrides: { 'provider:operations/worker': participant },
        }),
      ).rejects.toMatchObject({
        name: RuntimeBootError.name,
        cleanupErrors: expect.arrayContaining([
          expect.objectContaining({ name: LifecycleTimeoutError.name, phase: 'stop' }),
          expect.objectContaining({
            name: LifecycleCleanupTimeoutError.name,
            unsettled: expect.arrayContaining([
              { participantId: 'provider:operations/worker', phase: 'stop' },
              { participantId: 'provider:operations/worker', phase: 'dispose' },
            ]),
          }),
        ]),
      })
      expect(events).toEqual(['start', 'started', 'stop'])
    } finally {
      restoreTemporal(temporalDescriptor)
    }
  })
})

async function temporaryDirectory(prefix: string, parent = tmpdir()): Promise<string> {
  const directory = await mkdtemp(path.join(parent, prefix))
  temporaryDirectories.push(directory)
  return directory
}

function compileReferenceApplication(artifactsDirectory: string) {
  return compileApplication({
    tsconfigPath: path.join(referenceApplication, 'tsconfig.json'),
    applicationFile: path.join(referenceApplication, 'src/application.ts'),
    sourceRoot: path.join(referenceApplication, 'src'),
    outputRoot: path.join(referenceApplication, 'dist'),
    artifactsDirectory,
  })
}

function installMinimalTemporalIfMissing(): PropertyDescriptor | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal')
  if (descriptor) return descriptor
  Object.defineProperty(globalThis, 'Temporal', {
    configurable: true,
    value: {
      Instant: {
        fromEpochNanoseconds(epochNanoseconds: bigint) {
          return { epochNanoseconds }
        },
      },
    },
  })
  return undefined
}

function restoreTemporal(descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor)
  else delete (globalThis as { Temporal?: unknown }).Temporal
}
