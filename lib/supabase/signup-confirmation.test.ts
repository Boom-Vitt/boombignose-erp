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
it('a password recovery link lands on the reset form',async()=>{
 state.exchange.mockResolvedValue({error:null})
 const response=await GET(new NextRequest('https://app.example.test/auth/confirm?next=/reset-password&code=pkce'))
 expect(state.exchange).toHaveBeenCalledWith('pkce')
 expect(response.headers.get('location')).toBe('https://app.example.test/reset-password')
})
it('a recovery token hash also lands on the reset form',async()=>{
 state.verifyOtp.mockResolvedValue({error:null})
 const response=await GET(new NextRequest('https://app.example.test/auth/confirm?token_hash=t&type=recovery&next=%2Freset-password'))
 expect(state.verifyOtp).toHaveBeenCalledWith({type:'recovery',token_hash:'t'})
 expect(response.headers.get('location')).toBe('https://app.example.test/reset-password')
})
it.each(['https://evil.example.test/x','//evil.example.test','/login'])('an unsafe next %s falls back to the dashboard',async next=>{
 state.exchange.mockResolvedValue({error:null})
 const response=await GET(new NextRequest(`https://app.example.test/auth/confirm?code=pkce&next=${encodeURIComponent(next)}`))
 expect(response.headers.get('location')).toBe('https://app.example.test/dashboard')
})
it('an expired recovery code sends the user to request a new link',async()=>{
 state.exchange.mockResolvedValue({error:{message:'invalid request: both auth code and code verifier should be non-empty'}})
 const response=await GET(new NextRequest('https://app.example.test/auth/confirm?next=/reset-password&code=pkce'))
 const location=new URL(response.headers.get('location')!)
 expect(location.pathname).toBe('/forgot-password')
 expect(location.searchParams.get('error')).toMatch(/expired or was already used/)
})
it('an expired recovery token hash also offers a new link',async()=>{
 state.verifyOtp.mockResolvedValue({error:{message:'Email link is invalid or has expired'}})
 const response=await GET(new NextRequest('https://app.example.test/auth/confirm?token_hash=t&type=recovery'))
 expect(new URL(response.headers.get('location')!).pathname).toBe('/forgot-password')
})
it('a recovery link Supabase already rejected lands on forgot-password',async()=>{
 const response=await GET(new NextRequest('https://app.example.test/auth/confirm?next=%2Freset-password&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'))
 expect(new URL(response.headers.get('location')!).pathname).toBe('/forgot-password')
 expect(state.exchange).not.toHaveBeenCalled()
})
it('a rejected signup link shows the Supabase reason on sign-in',async()=>{
 const response=await GET(new NextRequest('https://app.example.test/auth/confirm?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'))
 expect(response.headers.get('location')).toBe('https://app.example.test/login?error=Email+link+is+invalid+or+has+expired')
})
it('signup rejects a weak password before calling Supabase',async()=>{
 expect(await signUp({email:'fixture-user@example.test',password:'short'})).toMatchObject({ok:false})
 expect(state.signUp).not.toHaveBeenCalled()
})
it('signup rejects a malformed email before calling Supabase',async()=>{
 expect(await signUp({email:'not-an-email',password:'FixturePass1234'})).toEqual({ok:false,error:'Enter a valid email address.'})
 expect(state.signUp).not.toHaveBeenCalled()
})
