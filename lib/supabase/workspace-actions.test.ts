import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  user: {id:'actor',email:'invitee@example.test'} as {id:string,email:string}|null,
  rpc: vi.fn(), setCookie: vi.fn(), admin: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
 auth: {getUser: async () => ({data:{user:state.user},error:null})}, rpc: state.rpc,
}) }))
vi.mock('@/lib/supabase/admin', () => ({createAdminClient: state.admin}))
vi.mock('next/headers', () => ({cookies: async () => ({set:state.setCookie})}))
vi.mock('next/navigation', () => ({redirect: (path:string) => {throw new Error(`REDIRECT:${path}`)}}))
vi.mock('next/cache', () => ({revalidatePath: vi.fn()}))
vi.mock('@/lib/audit', () => ({writeAudit: vi.fn()}))
import * as actions from '@/app/(app)/settings/org-actions'
import { createFirstWorkspace } from '@/app/onboarding/actions'
const orgId = '00000000-0000-4000-8000-000000000001'
const key = '00000000-0000-4000-8000-000000000002'

beforeEach(() => {
 vi.clearAllMocks()
 state.user = {id:'actor',email:'invitee@example.test'}
 state.rpc.mockResolvedValue({data:orgId,error:null})
 state.admin.mockImplementation(() => {throw new Error('Acceptance must not use service-role writes')})
})
afterEach(() => { vi.unstubAllEnvs() })
it('acceptance calls one authenticated atomic command and activates its returned org', async () => {
 await expect(actions.acceptInvitation({token:'valid-token'})).rejects.toThrow('REDIRECT:/dashboard')
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith('accept_workspace_invitation',{p_token:'valid-token'})
 expect(state.admin).not.toHaveBeenCalled()
 expect(state.setCookie).toHaveBeenCalledWith('active_org',orgId,expect.objectContaining({httpOnly:true,sameSite:'lax',path:'/'}))
})
it('failed acceptance does not activate a workspace', async () => {
 state.rpc.mockResolvedValue({data:null,error:{message:'Invitation unavailable'}})
 expect(await actions.acceptInvitation({token:'valid-token'})).toEqual({error:'Invitation unavailable'})
 expect(state.setCookie).not.toHaveBeenCalled()
})
it('signed-out acceptance preserves the invitation through sign-in', async () => {
 state.user = null
 await expect(actions.acceptInvitation({token:'valid-token'})).rejects.toThrow('REDIRECT:/login?redirect=%2Finvite%2Fvalid-token')
 expect(state.rpc).not.toHaveBeenCalled()
})
it('provisioning sends a normalized name and the caller retry key to one authenticated command', async () => {
 const provision = createFirstWorkspace
 await expect(provision({name:'  My workspace  ',key})).rejects.toThrow('REDIRECT:/dashboard')
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith('provision_workspace',{p_name:'My workspace',p_key:key})
 expect(state.setCookie).toHaveBeenCalledWith('active_org',orgId,expect.objectContaining({httpOnly:true}))
})

it.each([{name:'   ',key},{name:'x'.repeat(101),key},{name:'Workspace',key:'invalid'}])('invalid provision requests never reach the database: %j',async input=>{
 expect(await createFirstWorkspace(input)).toHaveProperty('error')
 expect(state.rpc).not.toHaveBeenCalled();expect(state.setCookie).not.toHaveBeenCalled()
})
it('signed-out provisioning reaches login without a database command',async()=>{
 state.user=null
 await expect(createFirstWorkspace({name:'Workspace',key})).rejects.toThrow('REDIRECT:/login?redirect=%2Fonboarding')
 expect(state.rpc).not.toHaveBeenCalled()
})

it.each([
 ['http://127.0.0.1:3106', false],
 ['http://localhost:3106', false],
 ['http://[::1]:3106', false],
 ['https://erp.example.test', true],
 ['https://localhost:3106', true],
 ['http://erp.example.test', true],
 ['http://localhost.example.test', true],
 ['http://127.1:3106', true],
 ['http://2130706433:3106', true],
 ['http://localhost.:3106', true],
 ['http://localhost:3106/?host=erp.example.test', true],
 ['http://localhost:99999', true],
 ['http://localhost@erp.example.test', true],
 ['invalid URL', true],
 [undefined, true],
] as const)('production workspace cookie uses only trusted configured loopback HTTP for its insecure exception: %s', async (appUrl, secure) => {
 vi.stubEnv('NODE_ENV', 'production')
 vi.stubEnv('NEXT_PUBLIC_APP_URL', appUrl)
 await expect(createFirstWorkspace({name:'Workspace',key})).rejects.toThrow('REDIRECT:/dashboard')
 expect(state.setCookie).toHaveBeenCalledWith('active_org',orgId,expect.objectContaining({secure,httpOnly:true,sameSite:'lax',path:'/'}))
})

it('a completed installation cannot create or activate another org through Community setup', async () => {
 state.rpc.mockResolvedValue({data:null,error:{message:'This installation already has a workspace. Ask an owner or admin for an invitation.'}})
 expect(await createFirstWorkspace({name:'Another workspace',key})).toHaveProperty('error')
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith('provision_workspace',{p_name:'Another workspace',p_key:key})
 expect(state.setCookie).not.toHaveBeenCalled()
})
