import {beforeEach, expect, it, vi} from 'vitest'
import {databaseFixture,pageContent} from './__tests__/tenant-fixture'
const state=vi.hoisted(()=>({user:{id:'invitee',email:'invitee@example.test'},org:null as null|{orgId:string},client:{} as unknown}))
vi.mock('@/lib/auth',()=>({getAuthenticatedUser:async()=>state.user,getOrgContext:async()=>state.org}))
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:state.user},error:null})}})}))
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>state.client}))
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw new Error(`REDIRECT:${path}`)}}))
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}))
vi.mock('@/app/(app)/settings/org-actions',()=>({acceptInvitation:vi.fn(),provisionWorkspace:vi.fn()}))
import OnboardingPage from '@/app/onboarding/page'
import InvitePage from '@/app/invite/[token]/page'
beforeEach(()=>{
 state.user={id:'invitee',email:'invitee@example.test'};state.org=null
 state.client=databaseFixture({invitations:[{token:'token',email:'invitee@example.test',role:'member',status:'pending',expires_at:'2099-01-01',org_id:'org',accepted_by:null}],organizations:[{id:'org',name:'PRIVATE_WORKSPACE'}]})
})
it('wrong-account invitation holders cannot see the organization or accept the invite',async()=>{
 state.user.email='someoneelse@example.test'
 const content=pageContent(await InvitePage({params:Promise.resolve({token:'token'})}))
 expect(content).not.toContain('PRIVATE_WORKSPACE')
 expect(content).toContain('Invitation unavailable')
})
it('the intended recipient can retry an already accepted invitation',async()=>{
 state.client=databaseFixture({invitations:[{token:'token',email:'invitee@example.test',role:'member',status:'accepted',expires_at:'2000-01-01',org_id:'org',accepted_by:'invitee'}],organizations:[{id:'org',name:'PRIVATE_WORKSPACE'}]})
 expect(pageContent(await InvitePage({params:Promise.resolve({token:'token'})}))).toContain('PRIVATE_WORKSPACE')
})
it('authenticated users without a workspace get a usable onboarding page',async()=>{
 const content=pageContent(await OnboardingPage())
 expect(content).toContain('Create your workspace')
 expect(content).toContain('invitation')
})
