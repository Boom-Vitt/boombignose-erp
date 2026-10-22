import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const state = vi.hoisted(() => ({ user: {id:'actor'} as {id:string}|null, setAll: undefined as undefined|((cookies:{name:string,value:string,options:object}[])=>void) }))
vi.mock('@supabase/ssr', () => ({createServerClient: (_url: unknown,_key:unknown,options:{cookies:{setAll:typeof state.setAll}}) => {
 state.setAll = options.cookies.setAll
 return {auth:{getUser:async()=>({data:{user:state.user},error:null}),getClaims:async()=>{
  state.setAll?.([{name:'refreshed-session',value:'valid-session',options:{httpOnly:true,path:'/'}}])
  return {data:state.user?{claims:state.user}:null,error:null}
 }}}
}}))
import { updateSession } from './middleware'
beforeEach(()=>{state.user={id:'actor'}})
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
