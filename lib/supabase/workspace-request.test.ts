import { expect,it } from 'vitest'
import { workspaceProvisionRequest } from '@/lib/supabase/workspace-request'
it('interrupted onboarding reuses the same actor/name command after reload',async()=>{
 const values=new Map<string,string>()
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}}
 const first=workspaceProvisionRequest('actor',' Workspace ',storage)
 const retry=workspaceProvisionRequest('actor','Workspace',storage)
 expect(retry).toEqual(first)
 expect(first.name).toBe('Workspace')
 expect(first.key).toMatch(/^[0-9a-f-]{36}$/)
 const changed=workspaceProvisionRequest('actor','Another name',storage)
 expect(changed.key).not.toBe(first.key)
 const anotherActor=workspaceProvisionRequest('someone-else','Workspace',storage)
 expect(anotherActor.key).not.toBe(first.key)
})
it('invalid stored commands and unavailable storage do not block onboarding',async()=>{
 const storage={getItem:()=>'{bad json',setItem:()=>{throw new Error('storage disabled')}}
 const first=workspaceProvisionRequest('actor','Workspace',storage)
 expect(first.key).toMatch(/^[0-9a-f-]{36}$/)
 expect(workspaceProvisionRequest('actor','Workspace',storage,first)).toEqual(first)
})
