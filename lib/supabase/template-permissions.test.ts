import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const state = vi.hoisted(() => ({ role: 'member', from: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: state.from }) }))
vi.mock('@/lib/auth', async () => {
  const { can } = await import('@/lib/permissions')
  return {
    requireOrgContext: async () => ({ userId: 'user', orgId: 'A', role: state.role }),
    requireCapability: (ctx: { role: 'member' }, capability: 'template:manage') => { if (!can(ctx.role, capability)) throw new Error('Forbidden') },
  }
})
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createCategory, createTemplate, updateTemplate } from '@/app/(app)/templates/actions'

const values = { name: 'Lead intake', implementationChecklist: [], tags: [] }

beforeEach(() => { state.role = 'member'; state.from.mockReset() })

it('members cannot create or edit templates', async () => {
  expect(await createTemplate(values)).toEqual({ error: 'Only owners and admins can manage templates.' })
  expect(await updateTemplate('tpl-A', values)).toEqual({ error: 'Only owners and admins can manage templates.' })
  expect(state.from).not.toHaveBeenCalled()
})

it('admins pass the capability check and reach the database', async () => {
  state.role = 'admin'
  const single = vi.fn(async () => ({ data: { id: 'tpl-new' }, error: null }))
  state.from.mockReturnValue({ insert: () => ({ select: () => ({ single }) }) })
  await createTemplate(values)
  expect(single).toHaveBeenCalled()
})

it('members cannot create template categories', async () => {
  expect(await createCategory({ name: 'Marketing' })).toEqual({ error: 'Only owners and admins can manage templates.' })
  expect(state.from).not.toHaveBeenCalled()
})

it('a Thai category name keeps a usable slug', async () => {
  state.role = 'owner'
  const insert = vi.fn(async () => ({ error: null }))
  state.from.mockReturnValue({ insert })
  expect(await createCategory({ name: ' การตลาด ออนไลน์ ' })).toEqual({})
  expect(insert).toHaveBeenCalledWith({ org_id: 'A', name: 'การตลาด ออนไลน์', slug: 'การตลาด-ออนไลน์' })
})
