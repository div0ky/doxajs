import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
})
