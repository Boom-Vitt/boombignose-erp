import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const state=vi.hoisted(()=>({signUp:vi.fn(),verifyOtp:vi.fn(),exchange:vi.fn(),user:null as {id:string}|null}))
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{signUp:state.signUp,verifyOtp:state.verifyOtp,exchangeCodeForSession:state.exchange,getUser:async()=>({data:{user:state.user},error:null})}})}))
import {signUp} from '@/app/signup/actions'
import {GET} from '@/app/auth/confirm/route'
beforeEach(()=>{vi.clearAllMocks();state.user=null})
it('signup without email confirmation returns an immediate session destination',async()=>{
 state.signUp.mockResolvedValue({data:{session:{access_token:'synthetic'},user:{id:'new'}},error:null})
 expect(await signUp({email:'new@example.test',password:'SecurePassword123'})).toEqual({ok:true,requiresConfirmation:false})
})
it('signup requiring confirmation reports that state',async()=>{
 state.signUp.mockResolvedValue({data:{session:null,user:{id:'new'}},error:null})
 expect(await signUp({email:'new@example.test',password:'SecurePassword123'})).toEqual({ok:true,requiresConfirmation:true})
})
it('a repeated confirmation link keeps an existing verified session usable',async()=>{
 state.user={id:'new'}
 state.verifyOtp.mockResolvedValue({error:{message:'Token already used'}})
 const response=await GET(new NextRequest('https://app.example.test/auth/confirm?token_hash=used&type=signup'))
 expect(response.headers.get('location')).toBe('https://app.example.test/dashboard')
})
it('a confirmation error without a session remains a sign-in error',async()=>{
 state.verifyOtp.mockResolvedValue({error:{message:'Expired token'}})
 const response=await GET(new NextRequest('https://app.example.test/auth/confirm?token_hash=expired&type=signup'))
 expect(response.headers.get('location')).toBe('https://app.example.test/login?error=Expired+token')
})
