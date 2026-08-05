import { Action, Authorization, Job, Query } from '@doxajs/core'

import { Group, GroupPermission, Permission, User, UserPermission } from './models/legacy-access.js'

export interface SeedLegacyAccessInput {
  readonly userId: string
  readonly branchTag: string
  readonly includeGroupOverride?: boolean
  readonly includeImpersonation?: boolean
}

export class SeedLegacyAccess extends Action<SeedLegacyAccessInput, void> {
  static readonly id = 'seed-legacy-access'
  static override readonly access = 'public'

  async handle(input: SeedLegacyAccessInput): Promise<void> {
    const groupId = `${input.userId}-group`
    await Group.create({ id: groupId, name: 'Legacy access group' })
    await Permission.create({
      id: `${input.userId}-contact-read`,
      resource: 'contact',
      action: 'read',
    })
    await Permission.create({
      id: `${input.userId}-branch-override`,
      resource: 'override',
      action: 'branch',
    })
    await Permission.create({
      id: `${input.userId}-user-update`,
      resource: 'user',
      action: 'update',
    })
    if (input.includeImpersonation) {
      await Permission.create({
        id: `${input.userId}-account-impersonate`,
        resource: 'account',
        action: 'impersonate',
      })
    }
    await User.create({
      id: input.userId,
      groupId,
      branchTag: input.branchTag,
    })
    await UserPermission.create({
      id: `${input.userId}-direct-contact-read`,
      userId: input.userId,
      permissionId: `${input.userId}-contact-read`,
    })
    await UserPermission.create({
      id: `${input.userId}-direct-user-update`,
      userId: input.userId,
      permissionId: `${input.userId}-user-update`,
    })
    if (input.includeImpersonation) {
      await UserPermission.create({
        id: `${input.userId}-direct-account-impersonate`,
        userId: input.userId,
        permissionId: `${input.userId}-account-impersonate`,
      })
    }
    if (input.includeGroupOverride !== false) {
      await GroupPermission.create({
        id: `${input.userId}-group-branch-override`,
        groupId,
        permissionId: `${input.userId}-branch-override`,
      })
    }
  }
}

export interface AuthorizedUserResult {
  readonly id: string
  readonly branchTag: string
  readonly directPermissions: readonly string[]
  readonly groupPermissions: readonly string[]
}

export let authorizedQueryUser: User | undefined
export let authorizedActionUser: User | undefined
export let authorizedJobUser: User | undefined

export function resetAuthorizationOperationProof(): void {
  authorizedQueryUser = undefined
  authorizedActionUser = undefined
  authorizedJobUser = undefined
}

export class ReadAuthorizedUser extends Query<BranchInput, AuthorizedUserResult> {
  static readonly id = 'read-authorized-user'
  static override readonly access = 'authorization.contact.read'

  private readonly authorization = this.inject(Authorization)

  async handle(input: BranchInput): Promise<AuthorizedUserResult> {
    const user = await User.with(['permissions', 'group.permissions']).findOrFail(input.userId)
    authorizedQueryUser = user
    await this.authorization.authorize('authorization.contact.read', {
      branchTag: input.branchTag,
    })
    return {
      id: user.id,
      branchTag: user.branchTag,
      directPermissions: user.permissions.map((permission) => permission.id).sort(),
      groupPermissions: user.group.permissions.map((permission) => permission.id).sort(),
    }
  }
}

export interface BranchInput {
  readonly userId: string
  readonly branchTag: string
}

export class ChangeAuthorizedUserBranch extends Action<BranchInput, string> {
  static readonly id = 'change-authorized-user-branch'
  static override readonly access = 'authorization.user.update'

  private readonly authorization = this.inject(Authorization)

  async handle(input: BranchInput): Promise<string> {
    const user = await User.findOrFail(input.userId)
    authorizedActionUser = user
    await this.authorization.authorize('authorization.contact.read', {
      branchTag: input.branchTag,
    })
    user.setAttribute('branchTag', input.branchTag)
    await user.save()
    return user.branchTag
  }
}

export class ChangeAuthorizedUserBranchJob extends Job<BranchInput> {
  static readonly id = 'change-authorized-user-branch-job'
  static override readonly access = 'authorization.user.update'

  private readonly authorization = this.inject(Authorization)

  async handle(input: BranchInput): Promise<void> {
    const user = await User.findOrFail(input.userId)
    authorizedJobUser = user
    await this.authorization.authorize('authorization.contact.read', {
      branchTag: input.branchTag,
    })
    user.setAttribute('branchTag', input.branchTag)
    await user.save()
  }
}

export class DispatchChangeAuthorizedUserBranchJob extends Action<BranchInput, string> {
  static readonly id = 'dispatch-change-authorized-user-branch-job'
  static override readonly access = 'public'

  async handle(input: BranchInput): Promise<string> {
    return await ChangeAuthorizedUserBranchJob.dispatch(input)
  }
}
