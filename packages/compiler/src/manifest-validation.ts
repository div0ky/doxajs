import type {
  JobManifestEntry,
  OperationManifestEntry,
  ProviderManifestEntry,
} from '@doxajs/manifest'

import { DoxaCompilationError } from './errors.js'

export function assertUnique<T>(
  items: readonly T[],
  identity: (item: T) => string,
  label: string,
): void {
  const seen = new Set<string>()
  for (const item of items) {
    const id = identity(item)
    if (seen.has(id)) throw new DoxaCompilationError(`Duplicate ${label}: ${id}`)
    seen.add(id)
  }
}

export function assertAcyclicProviderGraph(providers: readonly ProviderManifestEntry[]): void {
  const byId = new Map(providers.map((provider) => [provider.id, provider]))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) {
      throw new DoxaCompilationError(`Dependency cycle: ${[...path, id].join(' -> ')}`)
    }
    if (visited.has(id)) return
    const provider = byId.get(id)
    if (!provider) return
    visiting.add(id)
    for (const dependency of provider.dependencies) {
      if (dependency.targetId && byId.has(dependency.targetId)) {
        visit(dependency.targetId, [...path, id])
      }
    }
    visiting.delete(id)
    visited.add(id)
  }

  for (const provider of providers) visit(provider.id, [])
}

export function assertScopeSafety(providers: readonly ProviderManifestEntry[]): void {
  const byId = new Map(providers.map((provider) => [provider.id, provider]))

  const reachesExecutionScope = (id: string, visited: Set<string>): boolean => {
    if (visited.has(id)) return false
    visited.add(id)
    const provider = byId.get(id)
    if (!provider) return false
    if (provider.scope === 'execution') return true
    return provider.dependencies.some(
      (dependency) => dependency.targetId && reachesExecutionScope(dependency.targetId, visited),
    )
  }

  for (const provider of providers) {
    if (provider.scope !== 'singleton') continue
    for (const dependency of provider.dependencies) {
      if (dependency.targetId && reachesExecutionScope(dependency.targetId, new Set())) {
        throw new DoxaCompilationError(
          `[DOXA-COMPILER-SCOPE-001] Singleton ${provider.id} cannot depend on execution-scoped ${dependency.targetId}. See Gnosis guide concept.providers-provides.`,
        )
      }
    }
  }
}

export function assertNoNestedActionBusReachability(
  providers: readonly ProviderManifestEntry[],
  operations: readonly OperationManifestEntry[],
  jobs: readonly JobManifestEntry[],
): void {
  const providersById = new Map(providers.map((provider) => [provider.id, provider]))
  for (const root of [...operations, ...jobs]) {
    const visit = (targetId: string, path: readonly string[], seen: Set<string>): void => {
      if (targetId === 'doxa:action-bus') {
        throw new DoxaCompilationError(
          `[DOXA-COMPILER-ARCH-001] ${root.id} reaches ActionBus through ${[...path, targetId].join(' -> ')}. Nested Action dispatch from Actions, Queries, and Jobs is prohibited. Move reusable mutation behavior into an ordinary service and let each top-level Action or Job call it inside its own transaction. See Gnosis guide diagnostic.nested-action-dispatch.`,
        )
      }
      if (seen.has(targetId)) return
      seen.add(targetId)
      const provider = providersById.get(targetId)
      if (!provider) return
      for (const dependency of provider.dependencies) {
        if (dependency.targetId) {
          visit(dependency.targetId, [...path, targetId], new Set(seen))
        }
      }
    }
    for (const dependency of root.dependencies) {
      if (dependency.targetId) visit(dependency.targetId, [root.id], new Set())
    }
  }
}
