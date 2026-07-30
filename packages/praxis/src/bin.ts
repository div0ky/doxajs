#!/usr/bin/env node
import path from 'node:path'

import { runPraxis } from './index.js'

const arguments_ = process.argv.slice(2)
const applicationCwdOption = arguments_[0] === 'mcp' ? arguments_[1] : undefined

if (
  arguments_.length === 2 &&
  applicationCwdOption?.startsWith('--cwd=') &&
  applicationCwdOption.length > '--cwd='.length
) {
  const applicationCwd = path.resolve(process.cwd(), applicationCwdOption.slice('--cwd='.length))
  process.chdir(applicationCwd)
  process.exitCode = await runPraxis(['mcp'], applicationCwd)
} else {
  process.exitCode = await runPraxis(arguments_)
}
