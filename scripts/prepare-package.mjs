import { access, copyFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = process.cwd()
const assets = ['LICENSE', 'NOTICE']

if (process.argv.includes('--clean')) {
  await Promise.all(assets.map((asset) => rm(path.join(packageRoot, asset), { force: true })))
} else {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  const declaredArtifacts = new Set()

  const collectArtifacts = (value) => {
    if (typeof value === 'string') {
      if (value.startsWith('./dist/')) {
        declaredArtifacts.add(value.slice(2))
      }
      return
    }

    if (Array.isArray(value)) {
      value.forEach(collectArtifacts)
      return
    }

    if (value && typeof value === 'object') {
      Object.values(value).forEach(collectArtifacts)
    }
  }

  collectArtifacts(packageJson.exports)
  collectArtifacts(packageJson.bin)

  if (declaredArtifacts.size === 0) {
    throw new Error(
      `${packageJson.name ?? packageRoot} cannot be packed because it declares no built artifacts.`,
    )
  }

  for (const artifact of declaredArtifacts) {
    try {
      await access(path.join(packageRoot, artifact))
    } catch {
      throw new Error(
        `${packageJson.name ?? packageRoot} cannot be packed because ${artifact} is missing. Run pnpm build before publishing.`,
      )
    }
  }

  await Promise.all(
    assets.map((asset) =>
      copyFile(path.join(repositoryRoot, asset), path.join(packageRoot, asset)),
    ),
  )
}
