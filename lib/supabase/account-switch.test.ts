import { beforeEach,expect,it,vi } from 'vitest'
const state=vi.hoisted(()=>({signOut:vi.fn(),deleteCookie:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{signOut:state.signOut}})}))
vi.mock('next/headers',()=>({cookies:async()=>({delete:state.deleteCookie})}))
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw new Error(`REDIRECT:${path}`)}}))
import {signOutTo} from '@/app/onboarding/actions'
beforeEach(()=>{vi.clearAllMocks();state.signOut.mockResolvedValue({error:null})})
it('switching accounts clears the session and workspace cookie and preserves a local invitation',async()=>{
 await expect(signOutTo('/invite/token')).rejects.toThrow('REDIRECT:/login?redirect=%2Finvite%2Ftoken')
 expect(state.signOut).toHaveBeenCalledOnce()
 expect(state.deleteCookie).toHaveBeenCalledWith('active_org')
})
it('a sign-out failure leaves the current workspace intact',async()=>{
 state.signOut.mockResolvedValue({error:{message:'No connection'}})
 await expect(signOutTo('/onboarding')).rejects.toThrow('Unable to sign out')
 expect(state.deleteCookie).not.toHaveBeenCalled()
})
