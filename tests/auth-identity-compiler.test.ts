import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import { describeAuthentication } from '@doxajs/introspection'
import { afterEach, describe, expect, it } from 'vitest'

const workspace = path.resolve(import.meta.dirname, '..')
const temporaryDirectories: string[] = []

describe('compiled authentication identity mappings', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  it('preserves Doxa-owned defaults when identity is absent', async () => {
    const result = await compileFixture(`
      import { DoxaApplication, Feature } from '@doxajs/core'
      class AppFeature extends Feature { id = 'app' }
      export class Application extends DoxaApplication {
        id = 'default-auth'
        features = [AppFeature]
      }
    `)

    expect(result.manifest.authentication).toEqual(
      expect.objectContaining({
        mode: 'doxa-owned',
        source: 'doxa-owned',
        identifier: { kind: 'email', normalization: { preset: 'email' } },
        routes: {
          registration: true,
          verification: true,
          recovery: true,
          passwordChange: true,
        },
      }),
    )
  })

  it('resolves logical model attributes into an immutable managed mapping', async () => {
    const result = await compileFixture(`
      import { DoxaApplication, Feature, Instant, Model, type ModelAttributes } from '@doxajs/core'
      interface UserAttributes extends ModelAttributes {
        id: string
        email: string
        active: boolean
        emailVerifiedAt: Instant | null
        createdAt: Instant
        updatedAt: Instant
      }
      class User extends Model<UserAttributes> {
        static override readonly id = 'user'
        static override readonly table = 'legacy_users'
        static override readonly primaryKey = 'user_id'
        static override readonly columns = {
          id: 'user_id', email: 'email_address', active: 'enabled',
          emailVerifiedAt: 'verified_at', createdAt: 'created_at', updatedAt: 'updated_at',
        } as const
      }
      class UserRegistrationDefaults {
        defaults() { return { active: true } }
      }
      class AppFeature extends Feature { id = 'app'; models = [User] }
      export class Application extends DoxaApplication {
        id = 'managed-auth'
        features = [AppFeature]
        framework = { auth: { identity: {
          mode: 'managed', model: User,
          identifier: { kind: 'email', attribute: 'email', normalize: { preset: 'email' } },
          contactEmail: 'email',
          timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
          verification: { mode: 'mapped', attribute: 'emailVerifiedAt' },
          eligibility: [{ attribute: 'active', equals: true }],
          credentials: {
            table: 'legacy_users', identityId: 'user_id',
            readers: [
              { preset: 'doxa-argon2id', hash: 'password_hash' },
              { preset: 'bcrypt', hash: 'password_hash' },
            ],
            upgrade: {
              mode: 'in-place', format: 'doxa-argon2id',
              password: 'password_hash', updatedAt: 'updated_at',
            },
          },
          registrationFactory: UserRegistrationDefaults,
        } } } as const
      }
    `)

    expect(result.manifest.authentication).toEqual({
      mode: 'managed',
      source: 'model',
      modelId: 'model:app/user',
      table: 'legacy_users',
      columns: {
        id: 'user_id',
        identifier: 'email_address',
        contactEmail: 'email_address',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      attributes: {
        identifier: 'email',
        contactEmail: 'email',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        verification: 'emailVerifiedAt',
      },
      identifier: { kind: 'email', normalization: { preset: 'email' } },
      verification: { mode: 'mapped', column: 'verified_at' },
      eligibility: [{ column: 'enabled', equals: true }],
      credentials: {
        table: 'legacy_users',
        identityId: 'user_id',
        password: 'password_hash',
        readers: [
          { preset: 'doxa-argon2id', hash: 'password_hash' },
          { preset: 'bcrypt', hash: 'password_hash' },
        ],
        upgrade: {
          mode: 'in-place',
          format: 'doxa-argon2id',
          password: 'password_hash',
          updatedAt: 'updated_at',
        },
      },
      registrationFactoryId: 'service:app/user-registration-defaults',
      routes: {
        registration: true,
        verification: true,
        recovery: true,
        passwordChange: true,
      },
    })
  })

  it('compiles the raw table escape hatch as login-only capabilities', async () => {
    const result = await compileFixture(`
      import { DoxaApplication, Feature } from '@doxajs/core'
      class AppFeature extends Feature { id = 'app' }
      export class Application extends DoxaApplication {
        id = 'raw-auth'
        features = [AppFeature]
        framework = { auth: { identity: {
          mode: 'login-only', table: 'employees',
          columns: {
            id: 'employee_id', identifier: 'username', contactEmail: 'email',
            createdAt: 'created_at', updatedAt: 'updated_at', verification: 'verified_at',
          },
          identifier: { kind: 'username', normalize: { preset: 'lowercase' } },
          verification: { mode: 'mapped' },
          eligibility: [{ column: 'active', equals: true }],
          credentials: {
            table: 'employees', identityId: 'employee_id',
            readers: [{ preset: 'sha256-hex', hash: 'password' }],
          },
        } } } as const
      }
    `)

    expect(result.manifest.authentication).toEqual(
      expect.objectContaining({
        mode: 'login-only',
        source: 'table',
        table: 'employees',
        identifier: { kind: 'username', normalization: { preset: 'lowercase' } },
        routes: {
          registration: false,
          verification: false,
          recovery: false,
          passwordChange: false,
        },
        credentials: expect.objectContaining({
          password: 'password',
          upgrade: { mode: 'never' },
        }),
      }),
    )
    expect(describeAuthentication(result.manifest)).toEqual(
      expect.objectContaining({
        credentialOwnership: 'external',
        credentialUpgrade: 'never',
        securityWarnings: [expect.stringContaining('sha256-hex')],
      }),
    )
  })

  it('compiles explicit never and rejects removed sidecar verification', async () => {
    const never = await compileFixture(`
      import { DoxaApplication, Feature } from '@doxajs/core'
      class AppFeature extends Feature { id = 'app' }
      export class Application extends DoxaApplication {
        id = 'never-auth'; features = [AppFeature]
        framework = { auth: { identity: {
          mode: 'login-only', table: 'employees',
          columns: {
            id: 'employee_id', identifier: 'username',
            createdAt: 'created_at', updatedAt: 'updated_at',
          },
          identifier: { kind: 'username', normalize: { preset: 'lowercase' } },
          verification: { mode: 'trusted' },
          credentials: {
            table: 'employees', identityId: 'employee_id',
            readers: [{ preset: 'sha256-hex', hash: 'password' }],
            upgrade: 'never',
          },
        } } } as const
      }
    `)
    expect(never.manifest.authentication.credentials.upgrade).toEqual({ mode: 'never' })

    await expect(
      compileFixture(`
        import { DoxaApplication, Feature } from '@doxajs/core'
        class AppFeature extends Feature { id = 'app' }
        export class Application extends DoxaApplication {
          id = 'removed-sidecar-verification'; features = [AppFeature]
          framework = { auth: { identity: {
            mode: 'login-only', table: 'employees',
            columns: {
              id: 'employee_id', identifier: 'username',
              createdAt: 'created_at', updatedAt: 'updated_at',
            },
            identifier: { kind: 'username', normalize: { preset: 'lowercase' } },
            verification: { mode: 'sidecar' },
            credentials: {
              table: 'employees', identityId: 'employee_id',
              readers: [{ preset: 'sha256-hex', hash: 'password' }],
              upgrade: 'never',
            },
          } } } as const
        }
      `),
    ).rejects.toThrow('not assignable to type')
  })

  it('fails closed when a model mapping references an undeclared logical attribute', async () => {
    await expect(
      compileFixture(`
        import { DoxaApplication, Feature, Instant, Model, type ModelAttributes } from '@doxajs/core'
        interface UserAttributes extends ModelAttributes { id: string; createdAt: Instant; updatedAt: Instant }
        class User extends Model<UserAttributes> { static override readonly id = 'user'; static override readonly table = 'users' }
        class AppFeature extends Feature { id = 'app'; models = [User] }
        export class Application extends DoxaApplication {
          id = 'invalid-auth'; features = [AppFeature]
          framework = { auth: { identity: {
            mode: 'managed', model: User,
            identifier: { kind: 'email', attribute: 'missingEmail', normalize: { preset: 'email' } },
            timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
            verification: { mode: 'trusted' },
            credentials: {
              table: 'users', identityId: 'id',
              readers: [
                { preset: 'doxa-argon2id', hash: 'password' },
                { preset: 'bcrypt', hash: 'password' },
              ],
              upgrade: { mode: 'in-place', format: 'doxa-argon2id', password: 'password' },
            },
          } } } as const
        }
      `),
    ).rejects.toThrow('Auth identity attribute missingEmail is not declared')
  })

  it('compiles identities without a contact email as unsupported for email verification', async () => {
    const result = await compileFixture(`
      import { DoxaApplication, Feature, Instant, Model, type ModelAttributes } from '@doxajs/core'
      interface UserAttributes extends ModelAttributes {
        id: string; username: string; createdAt: Instant; updatedAt: Instant
      }
      class User extends Model<UserAttributes> {
        static override readonly id = 'user'
        static override readonly table = 'users'
      }
      class AppFeature extends Feature { id = 'app'; models = [User] }
      export class Application extends DoxaApplication {
        id = 'contactless-auth'; features = [AppFeature]
        framework = { auth: { identity: {
          mode: 'login-only', model: User,
          identifier: { kind: 'username', attribute: 'username', normalize: { preset: 'lowercase' } },
          timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
          verification: { mode: 'trusted' },
          credentials: {
            table: 'users', identityId: 'id', readers: [{ preset: 'bcrypt', hash: 'password' }],
          },
        } } } as const
      }
    `)

    expect(result.manifest.authentication.verification).toEqual({ mode: 'unsupported' })
    expect(result.manifest.authentication.routes).toEqual(
      expect.objectContaining({ verification: false, recovery: false }),
    )
  })

  it('disables verification when an external identity does not map a verification column', async () => {
    const result = await compileFixture(`
      import { DoxaApplication, Feature, Instant, Model, type ModelAttributes } from '@doxajs/core'
      interface UserAttributes extends ModelAttributes {
        id: string; email: string; createdAt: Instant; updatedAt: Instant
      }
      class User extends Model<UserAttributes> {
        static override readonly id = 'user'
        static override readonly table = 'users'
      }
      class AppFeature extends Feature { id = 'app'; models = [User] }
      export class Application extends DoxaApplication {
        id = 'unverified-external-auth'; features = [AppFeature]
        framework = { auth: { identity: {
          mode: 'managed', model: User,
          identifier: { kind: 'email', attribute: 'email', normalize: { preset: 'email' } },
          contactEmail: 'email',
          timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
          credentials: {
            table: 'users', identityId: 'id', readers: [{ preset: 'doxa-argon2id', hash: 'password' }],
            upgrade: { mode: 'in-place', format: 'doxa-argon2id', password: 'password' },
          },
        } } } as const
      }
    `)

    expect(result.manifest.authentication.verification).toEqual({ mode: 'unsupported' })
    expect(result.manifest.authentication.routes).toEqual(
      expect.objectContaining({ verification: false, recovery: true }),
    )
  })

  it('compiles a raw external table without verification as unsupported', async () => {
    const result = await compileFixture(`
      import { DoxaApplication, Feature } from '@doxajs/core'
      class AppFeature extends Feature { id = 'app' }
      export class Application extends DoxaApplication {
        id = 'raw-unverified-external-auth'; features = [AppFeature]
        framework = { auth: { identity: {
          mode: 'login-only', table: 'employees',
          columns: {
            id: 'employee_id', identifier: 'email', contactEmail: 'email',
            createdAt: 'created_at', updatedAt: 'updated_at',
          },
          identifier: { kind: 'email', normalize: { preset: 'email' } },
          credentials: {
            table: 'employees', identityId: 'employee_id',
            readers: [{ preset: 'bcrypt', hash: 'password' }],
          },
        } } } as const
      }
    `)

    expect(result.manifest.authentication.verification).toEqual({ mode: 'unsupported' })
    expect(result.manifest.authentication.routes.verification).toBe(false)
  })

  it('rejects incompatible identifier kinds and normalization presets', async () => {
    await expect(
      compileFixture(`
        import { DoxaApplication, Feature } from '@doxajs/core'
        class AppFeature extends Feature { id = 'app' }
        export class Application extends DoxaApplication {
          id = 'invalid-normalization'; features = [AppFeature]
          framework = { auth: { identity: {
            mode: 'login-only', table: 'users',
            columns: { id: 'id', identifier: 'email', createdAt: 'created_at', updatedAt: 'updated_at' },
            identifier: { kind: 'email', normalize: { preset: 'lowercase' } },
            verification: { mode: 'trusted' },
            credentials: {
              table: 'users', identityId: 'id', readers: [{ preset: 'bcrypt', hash: 'password' }],
            },
          } } } as const
        }
      `),
    ).rejects.toThrow('Email auth identifiers require email or email-or-domain normalization')
  })

  it('checks registration-factory services for duplicate stable provider IDs', async () => {
    await expect(
      compileFixture(`
        import { DoxaApplication, Feature, Instant, Model, type ModelAttributes } from '@doxajs/core'
        interface UserAttributes extends ModelAttributes {
          id: string; email: string; createdAt: Instant; updatedAt: Instant
        }
        class User extends Model<UserAttributes> {
          static override readonly id = 'user'
          static override readonly table = 'users'
        }
        class UserURL {}
        class RootProvider { static readonly id = 'root'; constructor(_url: UserURL) {} }
        class UserUrl { defaults() { return {} } }
        class AppFeature extends Feature {
          id = 'app'; providers = [RootProvider]; models = [User]
        }
        export class Application extends DoxaApplication {
          id = 'duplicate-factory'; features = [AppFeature]
          framework = { auth: { identity: {
            mode: 'managed', model: User,
            identifier: { kind: 'email', attribute: 'email', normalize: { preset: 'email' } },
            contactEmail: 'email',
            timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
            verification: { mode: 'trusted' },
            credentials: {
              table: 'users', identityId: 'id',
              readers: [
                { preset: 'doxa-argon2id', hash: 'password' },
                { preset: 'bcrypt', hash: 'password' },
              ],
              upgrade: { mode: 'in-place', format: 'doxa-argon2id', password: 'password' },
            },
            registrationFactory: UserUrl,
          } } } as const
        }
      `),
    ).rejects.toThrow('Duplicate provider ID: service:app/user-url')
  })
})

async function compileFixture(source: string) {
  const root = await mkdtemp(path.join(workspace, '.auth-identity-fixture-'))
  temporaryDirectories.push(root)
  await mkdir(path.join(root, 'src'))
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      extends: '../tsconfig.base.json',
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
