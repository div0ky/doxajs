import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const temporaryDirectories: string[] = []

type Candidate = {
  schemaVersion: number
  channel: string
  version: string
  packages: string[]
}

let generateReleaseCandidate: (root: string) => Promise<Candidate>
let validateReleaseCandidate: (root: string) => Promise<Candidate>
let selectReleaseCommit: (input: {
  eventName: string
  eventCommit: string
  manualCommit?: string
  changedFiles?: string[]
}) => { commit: string; shouldPublish: boolean }
let publicationDecision: (
  candidate: Candidate,
  registry: Record<string, { version?: string; alpha?: string; latest?: string }>,
) => { alreadyComplete: boolean; missing: string[] }
let verifyCoordinatedPublication: (
  candidate: Candidate,
  options: {
    inspect: (
      candidate: Candidate,
    ) => Promise<Record<string, { version?: string; alpha?: string; latest?: string }>>
    wait: (milliseconds: number) => Promise<void>
    attempts: number
    delayMs: number
  },
) => Promise<Record<string, { version?: string; alpha?: string; latest?: string }>>
let planReleaseTags: (
  candidate: Candidate,
  commit: string,
  existingTags?: Record<string, string>,
) => { tags: string[]; missing: string[] }

beforeAll(async () => {
  const candidateModule = (await import(
    pathToFileURL(path.join(repositoryRoot, 'scripts/release-candidate.mjs')).href
  )) as {
    generateReleaseCandidate: typeof generateReleaseCandidate
    validateReleaseCandidate: typeof validateReleaseCandidate
  }
  const selectionModule = (await import(
    pathToFileURL(path.join(repositoryRoot, 'scripts/select-release-commit.mjs')).href
  )) as {
    selectReleaseCommit: typeof selectReleaseCommit
  }
  const publishModule = (await import(
    pathToFileURL(path.join(repositoryRoot, 'scripts/publish-release.mjs')).href
  )) as {
    publicationDecision: typeof publicationDecision
    verifyCoordinatedPublication: typeof verifyCoordinatedPublication
  }
  const tagModule = (await import(
    pathToFileURL(path.join(repositoryRoot, 'scripts/tag-release.mjs')).href
  )) as {
    planReleaseTags: typeof planReleaseTags
  }
  generateReleaseCandidate = candidateModule.generateReleaseCandidate
  validateReleaseCandidate = candidateModule.validateReleaseCandidate
  selectReleaseCommit = selectionModule.selectReleaseCommit
  publicationDecision = publishModule.publicationDecision
  verifyCoordinatedPublication = publishModule.verifyCoordinatedPublication
  planReleaseTags = tagModule.planReleaseTags
})

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('alpha release state machine', () => {
  it('pins the Changesets latest-only prerelease publication patch', async () => {
    const workspace = await readFile(path.join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
    const patch = await readFile(
      path.join(repositoryRoot, 'patches/@changesets__cli@2.31.0.patch'),
      'utf8',
    )

    expect(workspace).toContain("'@changesets/cli@2.31.0': patches/@changesets__cli@2.31.0.patch")
    expect(patch).toContain(
      '-  if (preState !== undefined && pkgInfo.publishedState !== "only-pre") {',
    )
    expect(patch).toContain(
      '+    warn(`You are in prerelease mode; Doxa publishes the newest coordinated version to the ${pc.cyan("latest")} dist tag`);',
    )
  })

  it('generates one candidate for the repository current coordinated package set', async () => {
    const root = await currentReleaseMirror()
    const candidate = await generateReleaseCandidate(root)
    const core = JSON.parse(
      await readFile(path.join(repositoryRoot, 'packages/core/package.json'), 'utf8'),
    ) as { version: string }

    expect(candidate.version).toBe(core.version)
    expect(candidate.packages).toHaveLength(18)
    await expect(validateReleaseCandidate(root)).resolves.toEqual(candidate)
    await expect(
      readFile(path.join(root, 'docs/guides/doxa-agent-handbook.md'), 'utf8'),
    ).resolves.toContain(`@doxajs/gnosis\` ${core.version}.`)
  })

  it('synchronizes generated handbook version and records one coordinated candidate', async () => {
    const root = await releaseFixture('0.1.0-alpha.31')
    const candidate = await generateReleaseCandidate(root)

    expect(candidate).toEqual({
      schemaVersion: 1,
      channel: 'alpha',
      version: '0.1.0-alpha.31',
      packages: ['@doxajs/core', '@doxajs/gnosis'],
    })
    await expect(
      readFile(path.join(root, 'docs/guides/doxa-agent-handbook.md'), 'utf8'),
    ).resolves.toContain('@doxajs/gnosis` 0.1.0-alpha.31.')
    await expect(validateReleaseCandidate(root)).resolves.toEqual(candidate)
  })

  it('rejects mismatched package versions before a candidate can publish', async () => {
    const root = await releaseFixture('0.1.0-alpha.31')
    await writePackage(root, 'gnosis', {
      name: '@doxajs/gnosis',
      version: '0.1.0-alpha.32',
      dependencies: { '@doxajs/core': 'workspace:*' },
    })

    await expect(generateReleaseCandidate(root)).rejects.toThrow(
      'Doxa packages must publish as one coordinated version',
    )
  })

  it('keeps manual retries on the requested immutable candidate despite newer main changes', () => {
    const candidateCommit = 'a'.repeat(40)
    const newerMainCommit = 'b'.repeat(40)
    expect(
      selectReleaseCommit({
        eventName: 'workflow_dispatch',
        eventCommit: newerMainCommit,
        manualCommit: candidateCommit,
        changedFiles: ['.changeset/newer-change.md'],
      }),
    ).toEqual({ commit: candidateCommit, shouldPublish: true })
    expect(
      selectReleaseCommit({
        eventName: 'push',
        eventCommit: newerMainCommit,
        changedFiles: ['.changeset/newer-change.md'],
      }),
    ).toEqual({ commit: newerMainCommit, shouldPublish: false })
    expect(
      selectReleaseCommit({
        eventName: 'push',
        eventCommit: candidateCommit,
        changedFiles: ['.changeset/release-candidate.json'],
      }),
    ).toEqual({ commit: candidateCommit, shouldPublish: true })
    expect(() =>
      selectReleaseCommit({
        eventName: 'workflow_dispatch',
        eventCommit: newerMainCommit,
        manualCommit: 'changeset-release/main',
      }),
    ).toThrow('full 40-character commit SHA')
  })

  it('requires latest as the sole tag and refuses to roll it backward', () => {
    const candidate: Candidate = {
      schemaVersion: 1,
      channel: 'alpha',
      version: '0.1.0-alpha.31',
      packages: ['@doxajs/core', '@doxajs/gnosis'],
    }
    expect(
      publicationDecision(candidate, {
        '@doxajs/core': { version: candidate.version, latest: candidate.version },
        '@doxajs/gnosis': { latest: candidate.version },
      }),
    ).toEqual({ alreadyComplete: false, missing: ['@doxajs/gnosis'] })
    expect(
      publicationDecision(candidate, {
        '@doxajs/core': {
          version: candidate.version,
          alpha: candidate.version,
          latest: candidate.version,
        },
        '@doxajs/gnosis': {
          version: candidate.version,
          latest: candidate.version,
        },
      }),
    ).toEqual({ alreadyComplete: false, missing: ['@doxajs/core'] })
    expect(
      publicationDecision(candidate, {
        '@doxajs/core': { version: candidate.version, latest: candidate.version },
        '@doxajs/gnosis': { version: candidate.version, latest: candidate.version },
      }),
    ).toEqual({ alreadyComplete: true, missing: [] })
    expect(() =>
      publicationDecision(candidate, {
        '@doxajs/core': { version: candidate.version, latest: '0.1.0-alpha.32' },
        '@doxajs/gnosis': {
          version: candidate.version,
          latest: candidate.version,
        },
      }),
    ).toThrow('already has newer latest 0.1.0-alpha.32; refusing to move its tag backward')
  })

  it('retries coordinated registry verification while published versions and tags propagate', async () => {
    const candidate: Candidate = {
      schemaVersion: 1,
      channel: 'alpha',
      version: '0.1.0-alpha.32',
      packages: ['@doxajs/core', '@doxajs/gnosis'],
    }
    const stale = {
      '@doxajs/core': { version: candidate.version, latest: '0.1.0-alpha.31' },
      '@doxajs/gnosis': { alpha: '0.1.0-alpha.31', latest: '0.1.0-alpha.31' },
    }
    const complete = {
      '@doxajs/core': {
        version: candidate.version,
        latest: candidate.version,
      },
      '@doxajs/gnosis': {
        version: candidate.version,
        latest: candidate.version,
      },
    }
    const inspect = vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(complete)
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(
      verifyCoordinatedPublication(candidate, { inspect, wait, attempts: 3, delayMs: 25 }),
    ).resolves.toEqual(complete)
    expect(inspect).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledOnce()
    expect(wait).toHaveBeenCalledWith(25)
  })

  it('fails coordinated registry verification after the bounded propagation window', async () => {
    const candidate: Candidate = {
      schemaVersion: 1,
      channel: 'alpha',
      version: '0.1.0-alpha.32',
      packages: ['@doxajs/core'],
    }
    const inspect = vi.fn().mockResolvedValue({
      '@doxajs/core': { alpha: '0.1.0-alpha.31', latest: '0.1.0-alpha.31' },
    })
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(
      verifyCoordinatedPublication(candidate, { inspect, wait, attempts: 2, delayMs: 25 }),
    ).rejects.toThrow('Coordinated publication is incomplete for 0.1.0-alpha.32: @doxajs/core')
    expect(inspect).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledOnce()
  })

  it('creates only missing package tags and rejects conflicting source commits', () => {
    const candidate: Candidate = {
      schemaVersion: 1,
      channel: 'alpha',
      version: '0.1.0-alpha.32',
      packages: ['@doxajs/core', '@doxajs/gnosis'],
    }
    const commit = 'a'.repeat(40)
    const coreTag = '@doxajs/core@0.1.0-alpha.32'
    const gnosisTag = '@doxajs/gnosis@0.1.0-alpha.32'

    expect(planReleaseTags(candidate, commit, { [coreTag]: commit })).toEqual({
      tags: [coreTag, gnosisTag],
      missing: [gnosisTag],
    })
    expect(planReleaseTags(candidate, commit, { [coreTag]: commit, [gnosisTag]: commit })).toEqual({
      tags: [coreTag, gnosisTag],
      missing: [],
    })
    expect(() => planReleaseTags(candidate, commit, { [coreTag]: 'b'.repeat(40) })).toThrow(
      `expected ${commit}`,
    )
  })

  it('keeps full verification on feature PRs and publication scoped to exact commits', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> }
    const ciWorkflow = await readFile(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8')
    const releaseWorkflow = await readFile(
      path.join(repositoryRoot, '.github/workflows/release.yml'),
      'utf8',
    )

    expect(ciWorkflow).toContain("if: github.head_ref != 'changeset-release/main'")
    expect(ciWorkflow).toContain('run: pnpm verify')
    expect(ciWorkflow).toContain('run: pnpm release:validate')
    expect(packageJson.scripts['version:packages']).toBe(
      'changeset version && node scripts/release-candidate.mjs generate',
    )
    expect(packageJson.scripts['release:publish']).not.toContain('verify')
    expect(packageJson.scripts['release:publish']).not.toContain('audit:security')
    expect(releaseWorkflow).toContain('workflow_dispatch:')
    expect(releaseWorkflow).toContain('ref: ${{ needs.detect.outputs.commit }}')
    expect(releaseWorkflow).toContain('DOXA_RELEASE_COMMIT: ${{ needs.detect.outputs.commit }}')
    expect(releaseWorkflow).toContain('id-token: write')
    expect(releaseWorkflow).toContain('environment: npm')
    expect(releaseWorkflow).toContain('run: node scripts/tag-release.mjs')
    expect(releaseWorkflow).toContain('needs: [detect, publish]')
    expect(releaseWorkflow).toContain('contents: write')
    expect(releaseWorkflow).not.toContain('pnpm verify')
    expect(releaseWorkflow).not.toContain('registry-url:')
    expect(releaseWorkflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/)
  })
})

async function releaseFixture(version: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'doxa-release-'))
  temporaryDirectories.push(root)
  await Promise.all([
    mkdir(path.join(root, '.changeset'), { recursive: true }),
    mkdir(path.join(root, 'docs/guides'), { recursive: true }),
  ])
  await Promise.all([
    writePackage(root, 'core', { name: '@doxajs/core', version }),
    writePackage(root, 'gnosis', {
      name: '@doxajs/gnosis',
      version,
      dependencies: { '@doxajs/core': 'workspace:*' },
    }),
    writeFile(
      path.join(root, '.changeset/config.json'),
      `${JSON.stringify(
        {
          fixed: [['@doxajs/core', '@doxajs/gnosis']],
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      path.join(root, '.changeset/pre.json'),
      `${JSON.stringify({ mode: 'pre', tag: 'alpha' }, null, 2)}\n`,
    ),
    writeFile(
      path.join(root, 'docs/guides/doxa-agent-handbook.md'),
      '# Doxa Agent Handbook\n\n> Generated from the canonical handbook bundled with `@doxajs/gnosis` 0.1.0-alpha.30. Do not edit this file independently.\n',
    ),
  ])
  return root
}

async function currentReleaseMirror(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'doxa-current-release-'))
  temporaryDirectories.push(root)
  await Promise.all([
    mkdir(path.join(root, '.changeset'), { recursive: true }),
    mkdir(path.join(root, 'docs/guides'), { recursive: true }),
    mkdir(path.join(root, 'packages'), { recursive: true }),
  ])
  await Promise.all([
    copyFile(
      path.join(repositoryRoot, '.changeset/config.json'),
      path.join(root, '.changeset/config.json'),
    ),
    copyFile(
      path.join(repositoryRoot, '.changeset/pre.json'),
      path.join(root, '.changeset/pre.json'),
    ),
    copyFile(
      path.join(repositoryRoot, 'docs/guides/doxa-agent-handbook.md'),
      path.join(root, 'docs/guides/doxa-agent-handbook.md'),
    ),
  ])
  const packageDirectories = await readdir(path.join(repositoryRoot, 'packages'), {
    withFileTypes: true,
  })
  await Promise.all(
    packageDirectories
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const destination = path.join(root, 'packages', entry.name)
        await mkdir(destination, { recursive: true })
        await copyFile(
          path.join(repositoryRoot, 'packages', entry.name, 'package.json'),
          path.join(destination, 'package.json'),
        )
      }),
  )
  return root
}

async function writePackage(
  root: string,
  directory: string,
  metadata: {
    name: string
    version: string
    dependencies?: Record<string, string>
  },
): Promise<void> {
  const packageRoot = path.join(root, 'packages', directory)
  await mkdir(packageRoot, { recursive: true })
  await writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify(metadata, null, 2)}\n`)
}
