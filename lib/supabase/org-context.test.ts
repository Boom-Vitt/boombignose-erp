import { beforeEach, expect, it, vi } from 'vitest'
import { databaseFixture } from './__tests__/tenant-fixture'

const state = vi.hoisted(() => ({ user: { id: 'user', email: 'owner@example.test' } as {id:string,email:string}|null, preferred: '', client: {} as unknown }))
vi.mock('react', () => ({ cache: (fn: unknown) => fn }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: state.preferred }) }) }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ ...(state.client as object), auth: { getUser: async () => ({ data: {user:state.user}, error:null }) } }) }))
import { getOrgContext, requireOrgContext } from '@/lib/auth'
import { getUserOrgs } from '@/ee/workspaces/queries'

beforeEach(() => {
 state.user = {id:'user',email:'owner@example.test'}
 state.preferred = 'B'
 state.client = databaseFixture({
  memberships: [{user_id:'user',org_id:'A',role:'owner'},{user_id:'user',org_id:'B',role:'member'}],
  organizations: [{id:'A',name:'Workspace A'},{id:'B',name:'Workspace B'}],
 })
})
it('chooses only a current membership from the active cookie', async () => {
 expect((await getOrgContext())?.orgId).toBe('B')
 state.preferred = 'C'
 expect((await getOrgContext())?.orgId).toBe('A')
})
it('removed membership cannot be reused from a stale cookie', async () => {
 state.client = databaseFixture({memberships:[{user_id:'user',org_id:'A',role:'owner'}],organizations:[{id:'A',name:'A'}]})
 expect((await getOrgContext())?.orgId).toBe('A')
})
it('authenticated accounts without memberships reach onboarding', async () => {
 state.client = databaseFixture({})
 await expect(requireOrgContext()).rejects.toThrow('REDIRECT:/onboarding')
})
it('unauthenticated accounts still reach login', async () => {
 state.user = null
 await expect(requireOrgContext()).rejects.toThrow('REDIRECT:/login')
})
it('membership read failure does not pretend the user has no workspaces', async () => {
 state.client = {from: () => ({select: () => ({eq: () => ({order: async () => ({data:null,error:{message:'connection failed'}})})})})}
 await expect(getOrgContext()).rejects.toThrow('Unable to load workspace memberships')
 await expect(getUserOrgs()).rejects.toThrow('Unable to load workspace memberships')
})
