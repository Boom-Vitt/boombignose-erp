import { beforeEach, expect, it, vi } from 'vitest'
import type { OrgContext, Role } from '@/lib/auth'

const state = vi.hoisted(() => ({
 role: 'owner' as Role, user: {id:'actor'} as {id:string}|null, membership: null as object|null,
 calls: [] as string[][], setCookie: vi.fn(), audit: vi.fn(),
}))
/** Records every query builder call so a test can assert writes and their org scoping. */
function recorder(table: string) {
 const log = [table]
 state.calls.push(log)
 const query: Record<string, unknown> = {
  then: (resolve: (v: unknown) => unknown) => Promise.resolve({data: state.membership, error: null}).then(resolve),
 }
 for (const m of ['select','eq','upsert','update','maybeSingle']) query[m] = (...args: unknown[]) => { log.push(`${m}:${JSON.stringify(args[0])}${args.length > 1 ? `=${JSON.stringify(args[1])}` : ''}`); return query }
 return query
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
 auth: {getUser: async () => ({data:{user:state.user},error:null})}, from: recorder,
}) }))
vi.mock('@/lib/auth', async importOriginal => ({
 ...await importOriginal<typeof import('@/lib/auth')>(),
 requireOrgContext: async (): Promise<OrgContext> => ({userId:'actor',email:null,orgId:'org-a',orgName:'A',role:state.role}),
}))
vi.mock('next/headers', () => ({cookies: async () => ({set: state.setCookie})}))
vi.mock('next/navigation', () => ({redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) }}))
vi.mock('next/cache', () => ({revalidatePath: vi.fn()}))
vi.mock('@/lib/audit', () => ({writeAudit: state.audit}))

import { updateOrgSettings } from '@/app/(app)/settings/actions'
import { inviteMember, revokeInvitation, setActiveOrg } from '@/app/(app)/settings/org-actions'

const otherOrg = '00000000-0000-4000-8000-0000000000bb'
const invitee = ['teammate', 'example.test'].join('@')
beforeEach(() => { vi.clearAllMocks(); state.calls = []; state.role = 'owner'; state.user = {id:'actor'}; state.membership = null })

it('a member cannot change workspace settings and nothing is written', async () => {
 state.role = 'member'
 expect(await updateOrgSettings({orgName:'Renamed',cashBalanceBaht:1})).toEqual({error:'Only an owner or admin can update settings.'})
 expect(state.calls).toEqual([])
 expect(state.audit).not.toHaveBeenCalled()
})

it('settings writes are scoped to the caller org', async () => {
 state.role = 'admin'
 expect(await updateOrgSettings({orgName:'Renamed',cashBalanceBaht:1})).toEqual({})
 expect(state.calls.flat()).toEqual(expect.arrayContaining([expect.stringContaining('"org_id":"org-a"'), 'eq:"id"="org-a"']))
})

it('a member can neither invite nor revoke teammates', async () => {
 state.role = 'member'
 await expect(inviteMember({email:invitee})).rejects.toThrow('Forbidden')
 await expect(revokeInvitation({id:'inv'})).rejects.toThrow('Forbidden')
 expect(state.calls).toEqual([])
})

it('an invitation can never grant ownership', async () => {
 expect(await inviteMember({email:invitee,role:'owner' as 'admin'})).toHaveProperty('error')
 expect(state.calls).toEqual([])
})

it('revoking only touches a pending invitation of the caller org', async () => {
 expect(await revokeInvitation({id:'inv'})).toEqual({})
 expect(state.calls[0]).toEqual(['invitations','update:{"status":"revoked"}','eq:"id"="inv"','eq:"org_id"="org-a"','eq:"status"="pending"'])
})

it('switching to a workspace without a membership sets no cookie', async () => {
 expect(await setActiveOrg({orgId:otherOrg})).toEqual({error:'You are not a member of that workspace'})
 expect(state.calls[0]).toContain('eq:"user_id"="actor"')
 expect(state.setCookie).not.toHaveBeenCalled()
})

it('switching workspaces signed out reaches sign-in without a membership read', async () => {
 state.user = null
 await expect(setActiveOrg({orgId:otherOrg})).rejects.toThrow('REDIRECT:/login')
 expect(state.calls).toEqual([])
})

it('switching to a member workspace activates it with an httpOnly cookie', async () => {
 state.membership = {org_id: otherOrg}
 await expect(setActiveOrg({orgId:otherOrg})).rejects.toThrow('REDIRECT:/dashboard')
 expect(state.setCookie).toHaveBeenCalledWith('active_org', otherOrg, expect.objectContaining({httpOnly:true}))
})
