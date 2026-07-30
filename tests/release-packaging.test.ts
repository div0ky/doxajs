import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, '..')
const preparePackageScript = path.join(repositoryRoot, 'scripts', 'prepare-package.mjs')
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('release packaging', () => {
  it('keeps trusted publication release-scoped and fail-closed', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>
    }
    const releaseWorkflow = await readFile(
      path.join(repositoryRoot, '.github/workflows/release.yml'),
      'utf8',
    )

    expect(packageJson.scripts['release:check']).toBe('pnpm package:check && pnpm audit:security')
    expect(packageJson.scripts.release).toBe('pnpm release:check && changeset publish')
    expect(releaseWorkflow).toContain('id-token: write')
    expect(releaseWorkflow).toContain('environment: npm')
    expect(releaseWorkflow).toContain('registry-url: https://registry.npmjs.org')
    expect(releaseWorkflow).toContain('cache: pnpm')
    expect(releaseWorkflow).toContain('publish: pnpm release')
    expect(releaseWorkflow).not.toContain('pnpm verify')
    expect(releaseWorkflow).not.toContain('restore-keys:')
    expect(releaseWorkflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/)
  })

  it('refuses to pack a package whose declared build artifacts are missing', async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), 'doxa-package-'))
    temporaryDirectories.push(packageRoot)
    await writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@doxajs/release-fixture',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            default: './dist/index.js',
          },
        },
        bin: {
          doxa: './dist/bin.js',
        },
      }),
    )

    await expect(
      execFileAsync(process.execPath, [preparePackageScript], { cwd: packageRoot }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '@doxajs/release-fixture cannot be packed because dist/index.d.ts is missing',
      ),
    })

    await mkdir(path.join(packageRoot, 'dist'))
    await Promise.all(
      ['index.d.ts', 'index.js', 'bin.js'].map((artifact) =>
        writeFile(path.join(packageRoot, 'dist', artifact), ''),
      ),
    )

    await execFileAsync(process.execPath, [preparePackageScript], { cwd: packageRoot })

    await expect(readFile(path.join(packageRoot, 'NOTICE'), 'utf8')).resolves.toContain('Doxa')
  })

  it('bundles the executable Gnosis handbook without repository documentation or manifesto files', async () => {
    const archives = await mkdtemp(path.join(os.tmpdir(), 'doxa-gnosis-package-'))
    temporaryDirectories.push(archives)
    const { stdout } = await execFileAsync('pnpm', ['pack', '--pack-destination', archives], {
      cwd: path.join(repositoryRoot, 'packages/gnosis'),
    })
    const archive = stdout
      .trim()
      .split(/\r?\n/)
      .findLast((line) => line.endsWith('.tgz'))
    if (!archive) throw new Error('Gnosis package archive was not reported.')
    const { stdout: listing } = await execFileAsync('tar', ['-tzf', archive])
    const files = listing.trim().split(/\r?\n/)
    expect(files).toEqual(
      expect.arrayContaining([
        'package/dist/handbook.js',
        'package/dist/handbook.d.ts',
        'package/dist/documentation.js',
      ]),
    )
    expect(files.some((file) => file.startsWith('package/manifesto/'))).toBe(false)
    expect(files.some((file) => file.startsWith('package/docs/'))).toBe(false)
    const extracted = path.join(archives, 'extracted')
    await mkdir(extracted)
    await execFileAsync('tar', ['-xzf', archive, '-C', extracted])
    const handbook = (await import(
      pathToFileURL(path.join(extracted, 'package/dist/handbook.js')).href
    )) as {
      handbookIndex(version: string): readonly { readonly id: string }[]
      renderHandbookMarkdown(version: string): string
    }
    const packageMetadata = JSON.parse(
      await readFile(path.join(extracted, 'package/package.json'), 'utf8'),
    ) as { version: string }
    expect(handbook.handbookIndex(packageMetadata.version)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'programming-model.core' }),
        expect.objectContaining({ id: 'concept.orchestration-consistency' }),
        expect.objectContaining({ id: 'role.service' }),
      ]),
    )
    expect(handbook.renderHandbookMarkdown(packageMetadata.version)).toContain(
      'CreateNotification Action and DeliverDueReminders Job both call NotificationCreator.',
    )
  })
})
