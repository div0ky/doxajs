import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { validateReleaseCandidate } from './release-candidate.mjs'

const execute = promisify(execFile)
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const REGISTRY_VERIFY_ATTEMPTS = 24
const REGISTRY_VERIFY_DELAY_MS = 5_000

export function compareAlphaVersions(left, right) {
  const parse = (version) => {
    const match = /^(\d+)\.(\d+)\.(\d+)-alpha\.(\d+)$/.exec(version)
    if (!match) throw new Error(`Unsupported Doxa alpha version: ${version}`)
    return match.slice(1).map(Number)
  }
  const leftParts = parse(left)
  const rightParts = parse(right)
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}

export function publicationDecision(candidate, registryPackages) {
  const states = candidate.packages.map((name) => {
    const registry = registryPackages[name] ?? {}
    if (registry.latest && compareAlphaVersions(registry.latest, candidate.version) > 0) {
      throw new Error(
        `${name} already has newer latest ${registry.latest}; refusing to move its tag backward.`,
      )
    }
    return {
      name,
      published:
        registry.version === candidate.version &&
        registry.latest === candidate.version &&
        registry.alpha === undefined,
    }
  })
  return {
    alreadyComplete: states.every(({ published }) => published),
    missing: states.filter(({ published }) => !published).map(({ name }) => name),
  }
}

export function incompletePublication(candidate, registryPackages) {
  return candidate.packages.filter(
    (name) =>
      registryPackages[name]?.version !== candidate.version ||
      registryPackages[name]?.latest !== candidate.version ||
      registryPackages[name]?.alpha !== undefined,
  )
}

export async function verifyCoordinatedPublication(
  candidate,
  {
    inspect = inspectRegistry,
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    attempts = REGISTRY_VERIFY_ATTEMPTS,
    delayMs = REGISTRY_VERIFY_DELAY_MS,
  } = {},
) {
  let incomplete = [...candidate.packages]
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const registry = await inspect(candidate)
    incomplete = incompletePublication(candidate, registry)
    if (incomplete.length === 0) return registry
    if (attempt < attempts) {
      console.log(
        `Registry propagation pending for ${incomplete.join(', ')}; retrying in ${delayMs}ms (${attempt}/${attempts}).`,
      )
      await wait(delayMs)
    }
  }
  throw new Error(
    `Coordinated publication is incomplete for ${candidate.version}: ${incomplete.join(', ')}.`,
  )
}

async function main() {
  const expectedCommit = process.env.DOXA_RELEASE_COMMIT
  if (!COMMIT_PATTERN.test(expectedCommit ?? '')) {
    throw new Error('DOXA_RELEASE_COMMIT must be a full immutable commit SHA.')
  }
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'])
  const head = stdout.trim()
  if (head !== expectedCommit) {
    throw new Error(`Refusing to publish ${head}; expected release commit ${expectedCommit}.`)
  }

  const root = fileURLToPath(new URL('..', import.meta.url))
  const candidate = await validateReleaseCandidate(root, { requireBuiltHandbook: true })
  const before = await inspectRegistry(candidate)
  const decision = publicationDecision(candidate, before)
  if (!decision.alreadyComplete) {
    console.log(
      `Publishing ${candidate.version} from ${expectedCommit}; missing packages: ${decision.missing.join(', ')}.`,
    )
    const published = await execute('pnpm', ['exec', 'changeset', 'publish'], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    })
    process.stdout.write(published.stdout)
    process.stderr.write(published.stderr)
  } else {
    console.log(`${candidate.version} is already fully published; verifying tags without mutation.`)
  }

  await verifyCoordinatedPublication(candidate)
  console.log(
    `Verified ${candidate.version}, the latest tag, and no obsolete alpha tag for ${candidate.packages.length} packages.`,
  )
}

async function inspectRegistry(candidate) {
  return Object.fromEntries(
    await Promise.all(
      candidate.packages.map(async (name) => {
        const [version, tags] = await Promise.all([
          npmView([`${name}@${candidate.version}`, 'version', '--json'], true),
          npmView([name, 'dist-tags', '--json'], false),
        ])
        return [
          name,
          {
            version: version ? JSON.parse(version) : undefined,
            ...(tags ? JSON.parse(tags) : {}),
          },
        ]
      }),
    ),
  )
}

async function npmView(arguments_, allowMissing) {
  try {
    return (await execute('npm', ['view', ...arguments_], { maxBuffer: 1024 * 1024 })).stdout.trim()
  } catch (error) {
    if (
      allowMissing &&
      typeof error.stderr === 'string' &&
      (error.stderr.includes('E404') || error.stderr.includes('404 Not Found'))
    ) {
      return ''
    }
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
