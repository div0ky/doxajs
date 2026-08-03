import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PraxisCommandError } from './errors.js'
import { GNOSIS_CLIENT_RELOAD_GUIDANCE, installGnosisRegistration } from './gnosis-registration.js'

export interface CapturedProcess {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export interface UpgradeIo {
  readonly out: (message: string) => void
  readonly run: (
    command: string,
    arguments_: readonly string[],
    cwd: string,
    environment: NodeJS.ProcessEnv,
  ) => Promise<number>
  readonly capture: (
    command: string,
    arguments_: readonly string[],
    cwd: string,
    environment: NodeJS.ProcessEnv,
  ) => Promise<CapturedProcess>
}

interface DoxaCompatibility {
  readonly schemaVersion: 1
  readonly channel: string
  readonly frameworkPackages: readonly string[]
  readonly toolchain: {
    readonly node: string
    readonly packageManager: string
    readonly devDependencies: Readonly<Record<string, string>>
  }
  readonly upgradeRecipes: readonly string[]
}

interface PackageJson {
  name?: string
  packageManager?: string
  engines?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  [key: string]: unknown
}

interface UpgradeTarget {
  readonly version: string
  readonly compatibility: DoxaCompatibility
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export async function runUpgrade(
  cwd: string,
  args: readonly string[],
  io: UpgradeIo,
): Promise<number> {
  const options = parseUpgradeOptions(args)
  const packagePath = path.join(cwd, 'package.json')
  const original = await readFile(packagePath, 'utf8').catch((error: unknown) => {
    throw new PraxisCommandError(`Cannot upgrade: ${packagePath} is not readable.`, {
      cause: error,
    })
  })
  const packageJson = parsePackageJson(original, packagePath)
  const installedVersion = await installedPraxisVersion()

  if (options.continue) {
    return await continueUpgrade(cwd, packageJson, installedVersion, options, io)
  }

  const currentVersion = currentFrameworkVersion(packageJson)
  const targetSpecifier = options.to ?? 'latest'
  const target = await resolveTarget(cwd, targetSpecifier, io)
  assertSupportedTarget(target)
  assertNotDowngrade(currentVersion, target.version)
  const changes = plannedChanges(packageJson, target)

  printPlan(io, currentVersion, target, changes, options)
  if (changes.length === 0) {
    io.out('Package and toolchain declarations are already aligned.')
    return 0
  }
  if (options.dryRun) return 0

  await assertCleanWorktree(cwd, io, options.force)
  const upgraded = applyTarget(packageJson, target)
  await writeFile(packagePath, `${JSON.stringify(upgraded, null, 2)}\n`)

  io.out(
    currentVersion === target.version
      ? 'Aligning Doxa package and toolchain declarations with pnpm...'
      : 'Installing the aligned Doxa release with pnpm...',
  )
  const installCode = await io.run(pnpm, ['install'], cwd, process.env)
  if (installCode !== 0) {
    await writeFile(packagePath, original)
    io.out(
      'pnpm install failed; restored package.json. The lockfile or node_modules may need a fresh pnpm install.',
    )
    throw new PraxisCommandError(
      `Doxa upgrade stopped because pnpm install exited with ${installCode}.`,
    )
  }

  const continuation = [
    'exec',
    'doxa',
    'upgrade',
    '--continue',
    `--from=${currentVersion}`,
    `--to=${target.version}`,
  ]
  if (options.verify) continuation.push('--verify')
  if (options.skipMigrationStatus) continuation.push('--skip-migration-status')
  io.out(
    currentVersion === target.version
      ? 'Validating the alignment with the installed Praxis...'
      : 'Continuing with the newly installed Praxis...',
  )
  return await io.run(pnpm, continuation, cwd, process.env)
}

interface UpgradeOptions {
  readonly to?: string
  readonly dryRun: boolean
  readonly force: boolean
  readonly verify: boolean
  readonly skipMigrationStatus: boolean
  readonly continue: boolean
  readonly from?: string
}

function parseUpgradeOptions(args: readonly string[]): UpgradeOptions {
  const allowed = new Set([
    '--dry-run',
    '--force',
    '--verify',
    '--skip-migration-status',
    '--continue',
  ])
  let to: string | undefined
  let from: string | undefined
  for (const argument of args) {
    if (argument.startsWith('--to=')) to = argument.slice('--to='.length)
    else if (argument.startsWith('--from=')) from = argument.slice('--from='.length)
    else if (!allowed.has(argument))
      throw new PraxisCommandError(`Unknown upgrade option: ${argument}`)
  }
  if (to !== undefined && to.length === 0)
    throw new PraxisCommandError('--to requires a version or dist-tag.')
  return {
    ...(to === undefined ? {} : { to }),
    ...(from === undefined ? {} : { from }),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    verify: args.includes('--verify'),
    skipMigrationStatus: args.includes('--skip-migration-status'),
    continue: args.includes('--continue'),
  }
}

async function continueUpgrade(
  cwd: string,
  packageJson: PackageJson,
  installedVersion: string,
  options: UpgradeOptions,
  io: UpgradeIo,
): Promise<number> {
  if (!options.to || !versionPattern.test(options.to) || !options.from) {
    throw new PraxisCommandError('Invalid internal upgrade continuation. Run doxa upgrade again.')
  }
  if (installedVersion !== options.to) {
    throw new PraxisCommandError(
      `Upgrade installed Praxis ${installedVersion}, but ${options.to} was required. Restore the lockfile and run pnpm install before retrying.`,
    )
  }
  if (currentFrameworkVersion(packageJson) !== options.to) {
    throw new PraxisCommandError(`package.json is not aligned at Doxa ${options.to}.`)
  }

  const metadata = await installedCompatibility()
  for (const recipe of metadata.upgradeRecipes)
    await applyBuiltInRecipe(recipe, options.from, cwd, packageJson, io)

  io.out('Validating the upgraded application with doxa build...')
  let code = await io.run(pnpm, ['exec', 'doxa', 'build'], cwd, process.env)
  if (code !== 0) return validationFailure('doxa build', code, io)

  if (!options.skipMigrationStatus) {
    io.out('Checking forward migration status (read-only; "applied" means already recorded)...')
    code = await io.run(pnpm, ['exec', 'doxa', 'migrate:status'], cwd, process.env)
    if (code !== 0) return validationFailure('doxa migrate:status', code, io)
  }
  if (options.verify) {
    io.out('Running the application test suite...')
    code = await io.run(pnpm, ['test'], cwd, process.env)
    if (code !== 0) return validationFailure('pnpm test', code, io)
  }
  io.out(
    options.from === options.to
      ? `Doxa was already on ${options.to}. Package and toolchain declarations are aligned and the application passed validation. Review and commit the package and lockfile changes.`
      : `Upgraded Doxa from ${options.from} to ${options.to}. Review and commit the package and lockfile changes.`,
  )
  return 0
}

function validationFailure(command: string, code: number, io: UpgradeIo): number {
  io.out(
    `Upgrade packages are installed, but ${command} failed. Fix the reported application issue and rerun that command.`,
  )
  return code || 1
}

async function resolveTarget(
  cwd: string,
  specifier: string,
  io: UpgradeIo,
): Promise<UpgradeTarget> {
  const result = await io.capture(
    pnpm,
    ['view', `@doxajs/praxis@${specifier}`, 'version', 'doxaCompatibility', '--json'],
    cwd,
    process.env,
  )
  if (result.code !== 0) {
    throw new PraxisCommandError(
      `Could not resolve @doxajs/praxis@${specifier}: ${result.stderr.trim() || 'registry query failed'}`,
    )
  }
  let value: unknown
  try {
    value = JSON.parse(result.stdout)
  } catch (error) {
    throw new PraxisCommandError('The registry returned invalid Doxa release metadata.', {
      cause: error,
    })
  }
  if (!value || typeof value !== 'object')
    throw new PraxisCommandError('The target Doxa release has no compatibility metadata.')
  const record = value as { version?: unknown; doxaCompatibility?: unknown }
  if (
    typeof record.version !== 'string' ||
    !record.doxaCompatibility ||
    typeof record.doxaCompatibility !== 'object'
  ) {
    throw new PraxisCommandError(
      'The target Doxa release has no compatibility metadata. Choose a newer release.',
    )
  }
  return { version: record.version, compatibility: record.doxaCompatibility as DoxaCompatibility }
}

function assertSupportedTarget(target: UpgradeTarget): void {
  const compatibility = target.compatibility
  if (
    compatibility.schemaVersion !== 1 ||
    !Array.isArray(compatibility.frameworkPackages) ||
    !compatibility.toolchain ||
    typeof compatibility.toolchain.node !== 'string' ||
    typeof compatibility.toolchain.packageManager !== 'string' ||
    !compatibility.toolchain.devDependencies ||
    !Array.isArray(compatibility.upgradeRecipes)
  ) {
    throw new PraxisCommandError(`Doxa ${target.version} uses unsupported compatibility metadata.`)
  }
}

function currentFrameworkVersion(packageJson: PackageJson): string {
  const ranges: string[] = []
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    for (const [name, range] of Object.entries(packageJson[section] ?? {})) {
      if (name.startsWith('@doxajs/')) ranges.push(range)
    }
  }
  if (ranges.length === 0)
    throw new PraxisCommandError(
      'This application has no direct @doxajs/* dependencies to upgrade.',
    )
  const versions = new Set(ranges.map(versionFromRange))
  if (versions.size !== 1) {
    throw new PraxisCommandError(
      `Doxa dependencies are not aligned: ${[...new Set(ranges)].join(', ')}. Align them before upgrading.`,
    )
  }
  return [...versions][0]!
}

function versionFromRange(range: string): string {
  const version = range.replace(/^[~^]/, '')
  if (!versionPattern.test(version))
    throw new PraxisCommandError(
      `Unsupported Doxa dependency range: ${range}. Use a fixed ^version range.`,
    )
  return version
}

function assertNotDowngrade(current: string, target: string): void {
  if (compareVersions(target, current) < 0)
    throw new PraxisCommandError(`Refusing to downgrade Doxa from ${current} to ${target}.`)
}

function compareVersions(left: string, right: string): number {
  const tokenize = (version: string) =>
    version.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  const a = tokenize(left)
  const b = tokenize(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const av = a[index]
    const bv = b[index]
    if (av === bv) continue
    if (av === undefined) return 1
    if (bv === undefined) return -1
    if (typeof av === typeof bv) return av < bv ? -1 : 1
    return typeof av === 'number' ? -1 : 1
  }
  return 0
}

function plannedChanges(packageJson: PackageJson, target: UpgradeTarget): string[] {
  const changes: string[] = []
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    for (const [name, current] of Object.entries(packageJson[section] ?? {})) {
      if (!target.compatibility.frameworkPackages.includes(name)) continue
      const next = `^${target.version}`
      if (current !== next) changes.push(`${section}.${name}: ${current} -> ${next}`)
    }
  }
  const tools = target.compatibility.toolchain
  if (packageJson.packageManager !== tools.packageManager)
    changes.push(
      `packageManager: ${String(packageJson.packageManager ?? '(missing)')} -> ${tools.packageManager}`,
    )
  if (packageJson.engines?.node !== tools.node)
    changes.push(`engines.node: ${packageJson.engines?.node ?? '(missing)'} -> ${tools.node}`)
  for (const [name, version] of Object.entries(tools.devDependencies)) {
    const current = packageJson.devDependencies?.[name]
    if (current !== undefined && current !== version)
      changes.push(`devDependencies.${name}: ${current} -> ${version}`)
  }
  return changes
}

function applyTarget(packageJson: PackageJson, target: UpgradeTarget): PackageJson {
  const result = structuredClone(packageJson)
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    for (const name of Object.keys(result[section] ?? {})) {
      if (target.compatibility.frameworkPackages.includes(name))
        result[section]![name] = `^${target.version}`
    }
  }
  result.packageManager = target.compatibility.toolchain.packageManager
  result.engines = { ...(result.engines ?? {}), node: target.compatibility.toolchain.node }
  for (const [name, version] of Object.entries(target.compatibility.toolchain.devDependencies)) {
    if (result.devDependencies?.[name] !== undefined) result.devDependencies[name] = version
  }
  return result
}

function printPlan(
  io: UpgradeIo,
  current: string,
  target: UpgradeTarget,
  changes: readonly string[],
  options: UpgradeOptions,
): void {
  if (current === target.version) {
    const release = options.to ? 'the requested release' : 'the latest release'
    io.out(`Doxa is already on ${release}: ${target.version}.`)
    if (changes.length > 0) io.out('Doxa package and toolchain alignment plan:')
  } else {
    io.out(`Doxa upgrade plan: ${current} -> ${target.version}`)
  }
  for (const change of changes) io.out(`  ${change}`)
  if (changes.length === 0) {
    if (options.dryRun) io.out('Dry run only; no files were changed.')
    return
  }
  for (const recipe of target.compatibility.upgradeRecipes) io.out(`  recipe: ${recipe}`)
  io.out('  validate: doxa build')
  if (!options.skipMigrationStatus) io.out('  validate: doxa migrate:status (read-only)')
  if (options.verify) io.out('  validate: pnpm test')
  if (options.dryRun) io.out('Dry run only; no files were changed.')
}

async function assertCleanWorktree(cwd: string, io: UpgradeIo, force: boolean): Promise<void> {
  const status = await io.capture(
    'git',
    ['status', '--porcelain', '--untracked-files=normal'],
    cwd,
    process.env,
  )
  if (status.code !== 0) {
    io.out(
      'Git worktree check unavailable; continuing because this directory is not a Git worktree.',
    )
    return
  }
  if (status.stdout.trim() && !force) {
    throw new PraxisCommandError(
      'Refusing to upgrade a dirty Git worktree. Commit or stash changes, or rerun with --force.',
    )
  }
  if (status.stdout.trim())
    io.out('Warning: upgrading a dirty worktree because --force was provided.')
}

async function installedPraxisVersion(): Promise<string> {
  const metadata = await installedPraxisPackage()
  if (typeof metadata.version !== 'string')
    throw new PraxisCommandError('Installed Praxis has no valid version.')
  return metadata.version
}

async function installedCompatibility(): Promise<DoxaCompatibility> {
  const metadata = await installedPraxisPackage()
  if (!metadata.doxaCompatibility || typeof metadata.doxaCompatibility !== 'object') {
    throw new PraxisCommandError('Installed Praxis has no compatibility metadata.')
  }
  const target = {
    version: String(metadata.version),
    compatibility: metadata.doxaCompatibility as DoxaCompatibility,
  }
  assertSupportedTarget(target)
  return target.compatibility
}

async function installedPraxisPackage(): Promise<Record<string, unknown>> {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
  return parsePackageJson(await readFile(packagePath, 'utf8'), packagePath)
}

function parsePackageJson(content: string, location: string): PackageJson {
  try {
    return JSON.parse(content) as PackageJson
  } catch (error) {
    throw new PraxisCommandError(`Invalid JSON in ${location}.`, { cause: error })
  }
}

async function applyBuiltInRecipe(
  recipe: string,
  _from: string,
  cwd: string,
  packageJson: PackageJson,
  io: UpgradeIo,
): Promise<void> {
  if (recipe === 'framework-owned-application-core') {
    await migrateFrameworkOwnedApplicationCore(cwd, packageJson, io)
    return
  }
  if (recipe === 'gnosis-agent-registration') {
    const files = await installGnosisRegistration(cwd)
    io.out(
      `Registered Gnosis project MCP clients in ${files.join(', ')}. ${GNOSIS_CLIENT_RELOAD_GUIDANCE}`,
    )
    return
  }
  throw new PraxisCommandError(
    `Doxa release declares unknown upgrade recipe ${recipe}; no registry code was executed.`,
  )
}

const frameworkPluginPackages = [
  '@doxajs/opentelemetry',
  '@doxajs/sendgrid',
  '@doxajs/theoria',
  '@doxajs/twilio-sms',
] as const

async function migrateFrameworkOwnedApplicationCore(
  cwd: string,
  packageJson: PackageJson,
  io: UpgradeIo,
): Promise<void> {
  const applicationPath = path.join(cwd, 'app.config.ts')
  const legacyApplicationPath = path.join(cwd, 'src/application.ts')
  const legacyApplication = await readOptionalFile(legacyApplicationPath)
  const existingApplication = await readOptionalFile(applicationPath)
  if (!legacyApplication && !existingApplication) return

  const application =
    existingApplication ??
    migrateLegacyApplicationSource(
      legacyApplication!,
      frameworkPluginPackages.filter((packageName) =>
        packageHasDependency(packageJson, packageName),
      ),
    )
  const tsconfigPath = path.join(cwd, 'tsconfig.json')
  const tsconfigSource = await readOptionalFile(tsconfigPath)
  if (!tsconfigSource) {
    throw new PraxisCommandError(
      'The framework-owned application core upgrade requires an application tsconfig.json.',
    )
  }
  const tsconfig = migrateLegacyTypeScriptConfig(tsconfigSource, tsconfigPath)

  const appFeaturePath = path.join(cwd, 'src/app/app.feature.ts')
  const appFeature = await readOptionalFile(appFeaturePath)
  const migratedAppFeature = appFeature ? retireGeneratedHealthRoute(appFeature) : undefined

  if (!existingApplication) await writeFile(applicationPath, application, 'utf8')
  if (tsconfig !== tsconfigSource) await writeFile(tsconfigPath, tsconfig, 'utf8')
  if (migratedAppFeature !== undefined && migratedAppFeature !== appFeature)
    await writeFile(appFeaturePath, migratedAppFeature, 'utf8')

  if (!existingApplication || tsconfig !== tsconfigSource || migratedAppFeature !== appFeature) {
    io.out(
      'Applied framework-owned application core recipe: app.config.ts and TypeScript compilation now use the canonical application root; legacy src/application.ts remains for review.',
    )
  }
}

function migrateLegacyApplicationSource(source: string, plugins: readonly string[]): string {
  if (!/export class Application extends DoxaApplication/.test(source)) {
    throw new PraxisCommandError(
      'Cannot migrate src/application.ts automatically because it does not export class Application extends DoxaApplication.',
    )
  }
  let migrated = source.replace(/(from\s+['"])\.\//g, '$1./src/')
  for (const name of ['AccountsFeature', 'InfrastructureFeature']) {
    migrated = migrated.replace(
      new RegExp(`^import \\{ ${name} \\} from ['"][^'"]+['"]\\n`, 'm'),
      '',
    )
  }
  migrated = removeArrayMembers(migrated, 'features', ['AccountsFeature', 'InfrastructureFeature'])
  if (!/\n\s*plugins\s*=/.test(migrated)) {
    const rendered = plugins.map((packageName) => `'${packageName}'`).join(', ')
    migrated = migrated.replace(
      /(\n\s*features\s*=\s*\[[^\]]*\])/,
      `$1\n  plugins = [${rendered}] as const`,
    )
  }
  return migrated
}

function migrateLegacyTypeScriptConfig(source: string, location: string): string {
  let config: {
    compilerOptions?: Record<string, unknown>
    include?: unknown
    [key: string]: unknown
  }
  try {
    config = JSON.parse(source) as typeof config
  } catch (error) {
    throw new PraxisCommandError(`Cannot migrate invalid JSON in ${location}.`, { cause: error })
  }
  const compilerOptions = (config.compilerOptions ??= {})
  if (compilerOptions.rootDir === 'src') compilerOptions.rootDir = '.'
  if (compilerOptions.rootDir !== undefined && compilerOptions.rootDir !== '.') {
    throw new PraxisCommandError(
      `Cannot add app.config.ts to ${location} because compilerOptions.rootDir is not "." or "src".`,
    )
  }
  const include = config.include
  if (include !== undefined && (!Array.isArray(include) || !include.every(isString))) {
    throw new PraxisCommandError(`Cannot migrate non-string include entries in ${location}.`)
  }
  config.include = [
    'app.config.ts',
    ...((include as string[] | undefined) ?? []).filter(
      (entry) => entry !== 'app.config.ts' && entry !== '.doxa/framework.ts',
    ),
    '.doxa/framework.ts',
  ]
  return `${JSON.stringify(config, null, 2)}\n`
}

function retireGeneratedHealthRoute(source: string): string {
  if (!/\bHealthRoute\b/.test(source)) return source
  return removeArrayMembers(
    source.replace(/^import \{ HealthRoute \} from ['"][^'"]+['"]\n/m, ''),
    'routes',
    ['HealthRoute'],
  )
}

function packageHasDependency(packageJson: PackageJson, packageName: string): boolean {
  return Boolean(
    packageJson.dependencies?.[packageName] ??
    packageJson.devDependencies?.[packageName] ??
    packageJson.optionalDependencies?.[packageName],
  )
}

function removeArrayMembers(source: string, property: string, removed: readonly string[]): string {
  const pattern = new RegExp(`(${property}\\s*=\\s*\\[)([^\\]]*)(\\])`)
  if (!pattern.test(source)) {
    throw new PraxisCommandError(
      `Cannot migrate ${property}; expected a literal ${property} = [...] declaration.`,
    )
  }
  return source.replace(pattern, (_match, open: string, members: string, close: string) => {
    const retained = members
      .split(',')
      .map((member) => member.trim())
      .filter((member) => member && !removed.includes(member))
    return `${open}${retained.join(', ')}${close}`
  })
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

async function readOptionalFile(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
