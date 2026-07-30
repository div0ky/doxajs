import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = path.join(root, 'packages')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'doxa-packages-'))
const archivesDirectory = path.join(temporary, 'archives')
const packageDirectories = (await readdir(packagesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(packagesRoot, entry.name))
  .sort()

try {
  await execute('mkdir', ['-p', archivesDirectory])
  const archives = []
  const packedPackages = []
  for (const packageDirectory of packageDirectories) {
    const source = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'))
    assertPackageMetadata(source, packageDirectory)

    const { stdout } = await execute('pnpm', ['pack', '--pack-destination', archivesDirectory], {
      cwd: packageDirectory,
      maxBuffer: 10 * 1024 * 1024,
    })
    const archive = stdout
      .trim()
      .split(/\r?\n/)
      .findLast((line) => line.endsWith('.tgz'))
    if (!archive) throw new Error(`pnpm pack did not report an archive for ${source.name}.`)
    archives.push(archive)

    const { stdout: listing } = await execute('tar', ['-tzf', archive])
    const files = listing.trim().split(/\r?\n/)
    for (const required of [
      'package/LICENSE',
      'package/NOTICE',
      'package/README.md',
      'package/package.json',
      'package/dist/index.js',
      'package/dist/index.d.ts',
    ]) {
      if (!files.includes(required)) throw new Error(`${source.name} is missing ${required}.`)
    }
    const forbidden = files.find(
      (file) =>
        file.includes('.tsbuildinfo') || file.startsWith('package/src/') || / 2(?:\.|$)/.test(file),
    )
    if (forbidden)
      throw new Error(`${source.name} publishes forbidden build residue: ${forbidden}.`)

    const { stdout: packedJson } = await execute('tar', ['-xOf', archive, 'package/package.json'])
    if (packedJson.includes('workspace:')) {
      throw new Error(`${source.name} contains an unresolved workspace dependency.`)
    }
    const packedPackage = JSON.parse(packedJson)
    if (packedPackage.name !== source.name || packedPackage.version !== source.version) {
      throw new Error(`${source.name} packed with mismatched package identity or version.`)
    }
    packedPackages.push(packedPackage)
    await execute('pnpm', ['exec', 'publint', '--strict', archive], { cwd: root })
    await execute('pnpm', ['exec', 'attw', '--profile', 'esm-only', '--quiet', archive], {
      cwd: root,
    })
  }
  assertPackedPackageAlignment(packedPackages)

  const consumer = path.join(temporary, 'consumer')
  await execute('mkdir', ['-p', consumer])
  const packageNames = await Promise.all(
    packageDirectories.map(async (directory) => {
      const value = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
      return value.name
    }),
  )
  const packedDependencies = Object.fromEntries(
    packageNames.map((name, index) => [name, `file:${archives[index]}`]),
  )
  await writeFile(
    path.join(consumer, 'package.json'),
    `${JSON.stringify(
      {
        name: 'doxa-packed-consumer',
        private: true,
        type: 'module',
        dependencies: packedDependencies,
      },
      null,
      2,
    )}\n`,
  )
  await writeConsumerWorkspace(consumer, packedDependencies)
  await execute('pnpm', ['install'], {
    cwd: consumer,
    maxBuffer: 20 * 1024 * 1024,
  })
  await execute(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `await Promise.all(${JSON.stringify(packageNames)}.map((name) => import(name)))`,
    ],
    { cwd: consumer },
  )
  await execute(path.join(consumer, 'node_modules/.bin/doxa'), ['--help'], { cwd: consumer })

  const runtimeConsumer = path.join(temporary, 'runtime-consumer')
  await execute('mkdir', ['-p', runtimeConsumer])
  const runtimePackageNames = [
    '@doxajs/praxis',
    '@doxajs/auth-postgres',
    '@doxajs/core',
    '@doxajs/http-hono',
    '@doxajs/postgres-drizzle',
    '@doxajs/queue-pg-boss',
    '@doxajs/runtime',
  ]
  await writeFile(
    path.join(runtimeConsumer, 'package.json'),
    `${JSON.stringify(
      {
        name: 'doxa-packed-runtime-consumer',
        private: true,
        type: 'module',
        dependencies: Object.fromEntries(
          runtimePackageNames.map((name) => [name, packedDependencies[name]]),
        ),
      },
      null,
      2,
    )}\n`,
  )
  await writeConsumerWorkspace(runtimeConsumer, packedDependencies)
  await execute('pnpm', ['install', '--prod', '--no-optional'], {
    cwd: runtimeConsumer,
    maxBuffer: 20 * 1024 * 1024,
  })
  const productionStoreEntries = await readdir(path.join(runtimeConsumer, 'node_modules/.pnpm'))
  for (const forbidden of [
    '@doxajs/compiler',
    '@doxajs/gnosis',
    '@doxajs/theoria',
    '@modelcontextprotocol/sdk',
    'drizzle-kit',
    'typescript',
  ]) {
    const storePrefix = `${forbidden.replace('/', '+')}@`
    if (
      (await exists(path.join(runtimeConsumer, 'node_modules', ...forbidden.split('/')))) ||
      productionStoreEntries.some((entry) => entry.startsWith(storePrefix))
    ) {
      throw new Error(`Production dependency closure contains ${forbidden}.`)
    }
  }
  await execute(path.join(runtimeConsumer, 'node_modules/.bin/doxa'), ['--help'], {
    cwd: runtimeConsumer,
  })
  console.log(`Package audit passed for ${packageDirectories.length} Doxa packages.`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}

function assertPackedPackageAlignment(packages) {
  const names = new Set(packages.map((packageJson) => packageJson.name))
  const versions = new Set(packages.map((packageJson) => packageJson.version))
  if (versions.size !== 1) {
    throw new Error(`Packed Doxa packages have mismatched versions: ${[...versions].join(', ')}.`)
  }
  const [version] = versions
  for (const packageJson of packages) {
    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      for (const [name, range] of Object.entries(packageJson[field] ?? {})) {
        if (names.has(name) && range !== version) {
          throw new Error(
            `${packageJson.name} packed ${field}.${name} as ${range}; expected ${version}.`,
          )
        }
      }
    }
  }
}

function assertPackageMetadata(packageJson, directory) {
  const required = [
    'name',
    'version',
    'description',
    'license',
    'repository',
    'homepage',
    'bugs',
    'keywords',
    'engines',
    'publishConfig',
    'exports',
    'files',
  ]
  for (const field of required) {
    if (packageJson[field] === undefined) {
      throw new Error(`${path.relative(root, directory)}/package.json is missing ${field}.`)
    }
  }
  if (packageJson.private === true) throw new Error(`${packageJson.name} is still private.`)
  if (packageJson.license !== 'Apache-2.0')
    throw new Error(`${packageJson.name} has the wrong license.`)
  if (packageJson.publishConfig?.access !== 'public') {
    throw new Error(`${packageJson.name} is not configured for public publication.`)
  }
  if (packageJson.publishConfig?.provenance !== true) {
    throw new Error(`${packageJson.name} is not configured to publish npm provenance.`)
  }
}

async function writeConsumerWorkspace(directory, overrides) {
  await writeFile(
    path.join(directory, 'pnpm-workspace.yaml'),
    `packages:\n  - .\nallowBuilds:\n  esbuild: false\noverrides:\n${Object.entries(overrides)
      .map(([name, value]) => `  '${name}': '${value}'`)
      .join('\n')}\n`,
  )
}

async function exists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}
