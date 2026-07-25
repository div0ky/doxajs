import { spawnSync } from 'node:child_process'

const isVersionPullRequest =
  process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_HEAD_REF === 'changeset-release/main'

if (isVersionPullRequest) {
  console.log('Changeset authoring check skipped for the generated version pull request.')
  process.exit(0)
}

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(command, ['exec', 'changeset', 'status'], {
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
