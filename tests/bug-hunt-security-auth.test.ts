import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { installAuthSchema } from '@doxajs/auth-postgres'
import { PostgresAuth } from '@doxajs/auth-postgres/framework'
import { compileApplication } from '@doxajs/compiler'
import { Instant } from '@doxajs/core'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { assertManifest } from '../packages/manifest/dist/index.js'

const workspace = path.resolve(import.meta.dirname, '..')
const temporaryDirectories: string[] = []

describe('bug hunt: security and authentication', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  it('reserves the framework-owned impersonation stop ability', async () => {
    await expect(
      compileFixture(`
        import {
          DoxaApplication,
          Feature,
          PermissionSource,
          type PermissionSourceRequest,
        } from '@doxajs/core'

        class ApplicationPermissions extends PermissionSource {
          static override readonly id = 'application-permissions'
          static override readonly abilities = [
            'accounts.impersonate',
            'accounts.impersonation.stop',
          ]

          resolve(_request: PermissionSourceRequest) {
            return ['accounts.impersonate']
          }
        }

        class ApplicationFeature extends Feature {
          id = 'application'
          permissionSources = [ApplicationPermissions]
        }

        export class Application extends DoxaApplication {
          id = 'impersonation-stop-collision'
          features = [ApplicationFeature]
          framework = { auth: { impersonation: { enabled: true } } } as const
        }
      `),
    ).rejects.toThrow('accounts.impersonation.stop')
  })

  it('rejects a permission source that claims impersonation stop at the artifact boundary', async () => {
    const result = await compileFixture(`
      import {
        DoxaApplication,
        Feature,
        PermissionSource,
        type PermissionSourceRequest,
      } from '@doxajs/core'

      class ApplicationPermissions extends PermissionSource {
        static override readonly id = 'application-permissions'
        static override readonly abilities = ['accounts.impersonate']
        resolve(_request: PermissionSourceRequest) { return ['accounts.impersonate'] }
      }

      class ApplicationFeature extends Feature {
        id = 'application'
        permissionSources = [ApplicationPermissions]
      }

      export class Application extends DoxaApplication {
        id = 'impersonation-stop-manifest-collision'
        features = [ApplicationFeature]
        framework = { auth: { impersonation: { enabled: true } } } as const
      }
    `)
    const manifest = structuredClone(result.manifest) as unknown as {
      permissionSource: { abilities: string[] }
    }
    manifest.permissionSource.abilities.push('accounts.impersonation.stop')

    expect(() => assertManifest(manifest)).toThrow('permission source')
  })
})

// Preserved reproduction; bearer-token rotation is explicitly outside the selected fix set.
describe.skip('bug hunt: concurrent bearer rotation', () => {
  let container: StartedPostgreSqlContainer
  let connectionString: string
  let pool: Pool

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      process.env.DOXA_TEST_POSTGRES_IMAGE ?? 'postgres:17-alpine',
    ).start()
    connectionString = container.getConnectionUri()
    await installAuthSchema(connectionString)
    pool = new Pool({ connectionString })
  })

  afterAll(async () => {
    await pool?.end()
    await container?.stop()
  })

  it('allows exactly one successor when the same token rotates concurrently', async () => {
    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    await auth.start(lifecycleContext())
    const blocker = await pool.connect()

    try {
      const identity = await auth.register({
        identifier: `rotation-race-${Date.now()}@example.com`,
        password: 'concurrent rotation password',
      })
      const original = await auth.issueAccessToken(identity.id, { name: 'rotation-race' })

      await blocker.query('BEGIN')
      await blocker.query('SELECT id FROM doxa_auth_access_tokens WHERE id = $1 FOR UPDATE', [
        original.accessToken.id,
      ])

      const rotations = [
        auth.rotateAccessToken(identity.id, original.accessToken.id),
        auth.rotateAccessToken(identity.id, original.accessToken.id),
      ]
      await waitForBlockedRotations(pool)
      await blocker.query('COMMIT')

      const results = await Promise.allSettled(rotations)
      const active = await pool.query<{ count: string }>(
        `SELECT count(*) FROM doxa_auth_access_tokens
         WHERE identity_id = $1 AND revoked_at IS NULL`,
        [identity.id],
      )

      expect({
        fulfilledRotations: results.filter((result) => result.status === 'fulfilled').length,
        activeSuccessors: Number(active.rows[0]!.count),
      }).toEqual({ fulfilledRotations: 1, activeSuccessors: 1 })
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined)
      blocker.release()
      await auth.dispose(lifecycleContext())
    }
  })
})

async function compileFixture(source: string) {
  const root = await mkdtemp(path.join(workspace, '.bug-hunt-security-auth-'))
  temporaryDirectories.push(root)
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
  await writeFile(path.join(root, 'src/application.ts'), source)
  return await compileApplication({
    tsconfigPath: path.join(root, 'tsconfig.json'),
    applicationFile: path.join(root, 'src/application.ts'),
    sourceRoot: path.join(root, 'src'),
    outputRoot: path.join(root, 'dist'),
    artifactsDirectory: path.join(root, '.doxa'),
  })
}

async function waitForBlockedRotations(pool: Pool): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ count: string }>(`
      SELECT count(*)
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%doxa_auth_access_tokens%'
    `)
    if (Number(blocked.rows[0]!.count) >= 2) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Both concurrent rotations did not reach the locked token row.')
}

function lifecycleContext() {
  return {
    signal: new AbortController().signal,
    deadline: Instant.fromEpochMicroseconds(BigInt(Date.now() + 30_000) * 1_000n),
  }
}
