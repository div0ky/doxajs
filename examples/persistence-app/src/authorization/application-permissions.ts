import { PermissionSource, type PermissionSourceRequest } from '@doxajs/core'

import { User } from './models/legacy-access.js'

export type AuthorizationFixtureAbility =
  | 'accounts.impersonate'
  | 'authorization.branch.override'
  | 'authorization.contact.read'
  | 'authorization.user.update'

const ABILITIES: Readonly<Record<string, AuthorizationFixtureAbility>> = {
  'account:impersonate': 'accounts.impersonate',
  'contact:read': 'authorization.contact.read',
  'override:branch': 'authorization.branch.override',
  'user:update': 'authorization.user.update',
}

export let permissionSourceUser: User | undefined
export const permissionSourceUsers: User[] = []
export let permissionSourceWriteError: string | undefined
export let permissionSourceDeleteError: string | undefined
export let permissionSourceResolutions = 0

export function resetPermissionSourceProof(): void {
  permissionSourceUser = undefined
  permissionSourceUsers.length = 0
  permissionSourceWriteError = undefined
  permissionSourceDeleteError = undefined
  permissionSourceResolutions = 0
}

export class ApplicationPermissions extends PermissionSource {
  static override readonly id = 'application-permissions'
  static override readonly abilities = [
    'accounts.impersonate',
    'authorization.branch.override',
    'authorization.contact.read',
    'authorization.user.update',
  ]

  async resolve(request: PermissionSourceRequest): Promise<readonly AuthorizationFixtureAbility[]> {
    permissionSourceResolutions += 1
    if (request.actor.kind === 'anonymous' || !request.actor.id) return []

    const user = await User.with(['permissions', 'group.permissions']).find(request.actor.id)
    permissionSourceUser = user
    if (!user) return []
    permissionSourceUsers.push(user)

    try {
      await user.save()
    } catch (error) {
      permissionSourceWriteError = error instanceof Error ? error.name : String(error)
    }
    try {
      await user.delete()
    } catch (error) {
      permissionSourceDeleteError = error instanceof Error ? error.name : String(error)
    }

    const abilities = new Set<AuthorizationFixtureAbility>()
    for (const permission of [...user.permissions, ...user.group.permissions]) {
      const ability = ABILITIES[`${permission.resource}:${permission.action}`]
      if (ability) abilities.add(ability)
    }
    return [...abilities]
  }
}
