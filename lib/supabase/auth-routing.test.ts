import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
type TestUser = {id:string,factors?:{status:string}[]}
const state = vi.hoisted(() => ({ user: {id:'actor'} as TestUser|null, accessToken: undefined as string|undefined, setAll: undefined as undefined|((cookies:{name:string,value:string,options:object}[])=>void) }))
vi.mock('@supabase/ssr', () => ({createServerClient: (_url: unknown,_key:unknown,options:{cookies:{setAll:typeof state.setAll}}) => {
 state.setAll = options.cookies.setAll
 return {auth:{getUser:async()=>{
  state.setAll?.([{name:'refreshed-session',value:'valid-session',options:{httpOnly:true,path:'/'}}])
  return {data:{user:state.user},error:null}
 },getSession:async()=>({data:{session:state.accessToken?{access_token:state.accessToken}:null},error:null})}}
}}))
import { updateSession } from './middleware'
const jwt=(aal:string)=>`h.${btoa(JSON.stringify({aal})).replace(/=+$/,'')}.s`
const mfaUser=(aal:string)=>{state.user={id:'actor',factors:[{status:'verified'}]};state.accessToken=jwt(aal)}
beforeEach(()=>{state.user={id:'actor'};state.accessToken=jwt('aal1')})
it('already signed-in login preserves a local invitation destination', async () => {
 const res=await updateSession(new NextRequest('https://app.example.test/login?redirect=%2Finvite%2Fvalid-token'))
 expect(res.headers.get('location')).toBe('https://app.example.test/invite/valid-token')
})
it('refresh cookies survive an authentication redirect', async () => {
 const res=await updateSession(new NextRequest('https://app.example.test/login'))
 expect(res.cookies.get('refreshed-session')?.value).toBe('valid-session')
})
it.each(['https://other.example.test','//other.example.test','/\\other.example.test','javascript:alert(1)'])('rejects external or executable sign-in destination %s', async redirect => {
 const res=await updateSession(new NextRequest(`https://app.example.test/login?redirect=${encodeURIComponent(redirect)}`))
 expect(res.headers.get('location')).toBe('https://app.example.test/dashboard')
})
it('signed-out onboarding reaches login with its destination', async () => {
 state.user=null
 const res=await updateSession(new NextRequest('https://app.example.test/onboarding'))
 expect(res.headers.get('location')).toBe('https://app.example.test/login?redirect=%2Fonboarding')
})
it('a password-only session with a verified factor is sent to the TOTP challenge', async () => {
 mfaUser('aal1')
 const res=await updateSession(new NextRequest('https://app.example.test/dashboard'))
 expect(res.headers.get('location')).toBe('https://app.example.test/login/mfa?redirect=%2Fdashboard')
})
it('password recovery waits for the TOTP challenge before the reset form', async () => {
 mfaUser('aal1')
 const res=await updateSession(new NextRequest('https://app.example.test/reset-password'))
 expect(res.headers.get('location')).toBe('https://app.example.test/login/mfa?redirect=%2Freset-password')
})
it('a pending challenge keeps the sign-in destination', async () => {
 mfaUser('aal1')
 const res=await updateSession(new NextRequest('https://app.example.test/login?redirect=%2Finvite%2Fvalid-token'))
 expect(res.headers.get('location')).toBe('https://app.example.test/login/mfa?redirect=%2Finvite%2Fvalid-token')
})
it('the challenge page stays reachable while the challenge is pending', async () => {
 mfaUser('aal1')
 const res=await updateSession(new NextRequest('https://app.example.test/login/mfa?redirect=%2Fdashboard'))
 expect(res.headers.get('location')).toBeNull()
})
it('the sign-out route stays reachable while the challenge is pending', async () => {
 mfaUser('aal1')
 const res=await updateSession(new NextRequest('https://app.example.test/auth/signout'))
 expect(res.headers.get('location')).toBeNull()
})
it('a verified session reaches the app and skips the challenge page', async () => {
 mfaUser('aal2')
 expect((await updateSession(new NextRequest('https://app.example.test/dashboard'))).headers.get('location')).toBeNull()
 const res=await updateSession(new NextRequest('https://app.example.test/login/mfa?redirect=%2Fclients'))
 expect(res.headers.get('location')).toBe('https://app.example.test/clients')
})
it('users without a factor are not challenged', async () => {
 const res=await updateSession(new NextRequest('https://app.example.test/dashboard'))
 expect(res.headers.get('location')).toBeNull()
})
it('signed-out challenge page returns to sign-in with the original destination', async () => {
 state.user=null
 const res=await updateSession(new NextRequest('https://app.example.test/login/mfa?redirect=%2Finvite%2Fvalid-token'))
 expect(res.headers.get('location')).toBe('https://app.example.test/login?redirect=%2Finvite%2Fvalid-token')
})
it('signed-out forgot-password is public', async () => {
 state.user=null
 expect((await updateSession(new NextRequest('https://app.example.test/forgot-password'))).headers.get('location')).toBeNull()
})
it('signed-out reset form offers a new reset link instead of sign-in', async () => {
 state.user=null
 const location=new URL((await updateSession(new NextRequest('https://app.example.test/reset-password'))).headers.get('location')!)
 expect(location.pathname).toBe('/forgot-password')
 expect(location.searchParams.get('error')).toBe('reset_expired')
})
it('signed-out authenticator setup asks for sign-in first', async () => {
 state.user=null
 const res=await updateSession(new NextRequest('https://app.example.test/setup-2fa'))
 expect(res.headers.get('location')).toBe('https://app.example.test/login?redirect=%2Fsetup-2fa')
})
it('an unenrolled user can open authenticator setup', async () => {
 expect((await updateSession(new NextRequest('https://app.example.test/setup-2fa'))).headers.get('location')).toBeNull()
})
it('an abandoned unverified factor neither challenges nor blocks setup', async () => {
 state.user={id:'actor',factors:[{status:'unverified'}]}
 expect((await updateSession(new NextRequest('https://app.example.test/dashboard'))).headers.get('location')).toBeNull()
 expect((await updateSession(new NextRequest('https://app.example.test/setup-2fa'))).headers.get('location')).toBeNull()
})
it('an enrolled user is not offered a second authenticator', async () => {
 mfaUser('aal2')
 const res=await updateSession(new NextRequest('https://app.example.test/setup-2fa'))
 expect(res.headers.get('location')).toBe('https://app.example.test/dashboard')
})
it('an enrolled password-only session clears its challenge before setup', async () => {
 mfaUser('aal1')
 const res=await updateSession(new NextRequest('https://app.example.test/setup-2fa'))
 expect(res.headers.get('location')).toBe('https://app.example.test/login/mfa?redirect=%2Fsetup-2fa')
})
it('an enrolled user leaves setup for the carried invitation destination', async () => {
 mfaUser('aal2')
 const res=await updateSession(new NextRequest('https://app.example.test/setup-2fa?redirect=%2Finvite%2Fvalid-token'))
 expect(res.headers.get('location')).toBe('https://app.example.test/invite/valid-token')
})
it('signed-out setup keeps its invitation destination through sign-in', async () => {
 state.user=null
 const res=await updateSession(new NextRequest('https://app.example.test/setup-2fa?redirect=%2Finvite%2Fvalid-token'))
 const location=new URL(res.headers.get('location')!)
 expect(location.pathname).toBe('/login')
 expect(location.searchParams.get('redirect')).toBe('/setup-2fa?redirect=%2Finvite%2Fvalid-token')
})
it('signed-out deep links keep their query through sign-in', async () => {
 state.user=null
 const res=await updateSession(new NextRequest('https://app.example.test/finance?tab=invoices'))
 expect(new URL(res.headers.get('location')!).searchParams.get('redirect')).toBe('/finance?tab=invoices')
})
it('a pending challenge keeps the query of the page it interrupted', async () => {
 mfaUser('aal1')
 const res=await updateSession(new NextRequest('https://app.example.test/setup-2fa?redirect=%2Finvite%2Fvalid-token'))
 expect(new URL(res.headers.get('location')!).searchParams.get('redirect')).toBe('/setup-2fa?redirect=%2Finvite%2Fvalid-token')
})
it.each(['/portal/share-token','/api/webhooks/n8n/followup','/api/cron/outbox','/','/blueprint-preview'])('signed-out %s stays public', async path => {
 state.user=null
 expect((await updateSession(new NextRequest(`https://app.example.test${path}`))).headers.get('location')).toBeNull()
})
it('a route that only shares a public prefix still needs sign-in', async () => {
 state.user=null
 const res=await updateSession(new NextRequest('https://app.example.test/portals'))
 expect(res.headers.get('location')).toBe('https://app.example.test/login?redirect=%2Fportals')
})
it('a pending challenge does not block the public client portal', async () => {
 mfaUser('aal1')
 expect((await updateSession(new NextRequest('https://app.example.test/portal/share-token'))).headers.get('location')).toBeNull()
})
it('a signed-in sign-up visit with a pending challenge goes to the challenge, not the app', async () => {
 mfaUser('aal1')
 const res=await updateSession(new NextRequest('https://app.example.test/signup?redirect=%2Fdeals'))
 expect(res.headers.get('location')).toBe('https://app.example.test/login/mfa?redirect=%2Fdeals')
})
it.each(['/login','/setup-2fa'])('a dot-segment destination on %s cannot leave the app', async path => {
 mfaUser('aal2')
 const res=await updateSession(new NextRequest(`https://app.example.test${path}?redirect=${encodeURIComponent('/.//evil.example.test')}`))
 expect(res.headers.get('location')).toBe('https://app.example.test/dashboard')
})
it('a pending challenge carries only a sanitized destination to the challenge page', async () => {
 mfaUser('aal1')
 const res=await updateSession(new NextRequest(`https://app.example.test/login?redirect=${encodeURIComponent('//evil.example.test')}`))
 expect(res.headers.get('location')).toBe('https://app.example.test/login/mfa?redirect=%2Fdashboard')
})
it('a pending challenge blocks non-public API routes, not only pages', async () => {
 mfaUser('aal1')
 expect(new URL((await updateSession(new NextRequest('https://app.example.test/api/export?x=1'))).headers.get('location')!).pathname).toBe('/login/mfa')
})
