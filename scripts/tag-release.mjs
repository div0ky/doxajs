import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { RELEASE_CANDIDATE_PATH } from './release-candidate.mjs'

const execute = promisify(execFile)
const COMMIT_PATTERN = /^[0-9a-f]{40}$/

export function planReleaseTags(candidate, commit, existingTags = {}) {
  if (!COMMIT_PATTERN.test(commit ?? '')) {
    throw new Error('Release tags require a full immutable commit SHA.')
  }
  const tags = candidate.packages.map((name) => `${name}@${candidate.version}`)
  const missing = []
  for (const tag of tags) {
    const existing = existingTags[tag]
    if (existing && existing !== commit) {
      throw new Error(`Release tag ${tag} resolves to ${existing}; expected ${commit}.`)
    }
    if (!existing) missing.push(tag)
  }
  return { tags, missing }
}

async function main() {
  const expectedCommit = process.env.DOXA_RELEASE_COMMIT
  if (!COMMIT_PATTERN.test(expectedCommit ?? '')) {
    throw new Error('DOXA_RELEASE_COMMIT must be a full immutable commit SHA.')
  }
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { stdout: headOutput } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root })
  const head = headOutput.trim()
  if (head !== expectedCommit) {
    throw new Error(`Refusing to tag ${head}; expected release commit ${expectedCommit}.`)
  }

  const candidate = JSON.parse(
    await readFile(new URL(`../${RELEASE_CANDIDATE_PATH}`, import.meta.url)),
  )
  const tagNames = candidate.packages.map((name) => `${name}@${candidate.version}`)
  const existingTags = await readRemoteTags(root, tagNames)
  const plan = planReleaseTags(candidate, expectedCommit, existingTags)

  for (const tag of plan.missing) {
    await execute('git', ['tag', tag, expectedCommit], { cwd: root })
  }
  if (plan.missing.length > 0) {
    await execute('git', ['push', 'origin', ...plan.missing.map((tag) => `refs/tags/${tag}`)], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    })
  }

  const verified = await readRemoteTags(root, plan.tags)
  planReleaseTags(candidate, expectedCommit, verified)
  if (Object.keys(verified).length !== plan.tags.length) {
    throw new Error(`Remote release tag set is incomplete for ${candidate.version}.`)
  }
  console.log(`Verified ${plan.tags.length} release tags at ${expectedCommit}.`)
}

async function readRemoteTags(root, tags) {
  const references = tags.map((tag) => `refs/tags/${tag}`)
  const { stdout } = await execute('git', ['ls-remote', '--tags', 'origin', ...references], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  })
  return Object.fromEntries(
    stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [commit, reference] = line.split(/\s+/)
        return [reference.slice('refs/tags/'.length), commit]
      }),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
