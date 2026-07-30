import { execFile } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { RELEASE_CANDIDATE_PATH } from './release-candidate.mjs'

const execute = promisify(execFile)
const COMMIT_PATTERN = /^[0-9a-f]{40}$/

export function selectReleaseCommit({ eventName, eventCommit, manualCommit, changedFiles = [] }) {
  const commit = eventName === 'workflow_dispatch' ? manualCommit : eventCommit
  if (!COMMIT_PATTERN.test(commit ?? '')) {
    throw new Error('Alpha publication requires an explicit full 40-character commit SHA.')
  }
  return {
    commit,
    shouldPublish:
      eventName === 'workflow_dispatch' || changedFiles.includes(RELEASE_CANDIDATE_PATH),
  }
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME
  const eventCommit = process.env.GITHUB_SHA
  const manualCommit = process.env.RELEASE_COMMIT_INPUT
  const { stdout: headOutput } = await execute('git', ['rev-parse', 'HEAD'])
  const head = headOutput.trim()
  const changedFiles =
    eventName === 'push'
      ? (await execute('git', ['diff', '--name-only', `${head}^1`, head])).stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
      : []
  const selection = selectReleaseCommit({
    eventName,
    eventCommit,
    manualCommit,
    changedFiles,
  })
  if (selection.commit !== head) {
    throw new Error(`Checked out ${head}, but the selected release commit is ${selection.commit}.`)
  }
  if (eventName === 'workflow_dispatch') {
    await execute('git', ['merge-base', '--is-ancestor', head, 'origin/main'])
  }
  const output = process.env.GITHUB_OUTPUT
  if (!output) throw new Error('GITHUB_OUTPUT is required.')
  await appendFile(
    output,
    `commit=${selection.commit}\nshould_publish=${selection.shouldPublish ? 'true' : 'false'}\n`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
