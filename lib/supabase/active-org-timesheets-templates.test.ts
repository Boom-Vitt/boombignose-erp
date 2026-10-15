import { beforeEach, expect, it, vi } from 'vitest'
import { databaseFixture, pageContent } from './__tests__/tenant-fixture'

vi.mock('server-only', () => ({}))
const state = vi.hoisted(() => ({ client: {} as unknown }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }))
vi.mock('@/lib/auth', () => ({ requireOrgContext: async () => ({ userId: 'user', orgId: 'A', role: 'owner' }) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') }, redirect: vi.fn(), useRouter: vi.fn(), useSearchParams: vi.fn(), usePathname: () => '' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import TimesheetsPage from '@/app/(app)/timesheets/page'
import { logTime } from '@/app/(app)/timesheets/actions'
import TemplatesPage from '@/app/(app)/templates/page'
import TemplateDetailPage from '@/app/(app)/templates/[id]/page'
import EditTemplatePage from '@/app/(app)/templates/[id]/edit/page'
import NewTemplatePage from '@/app/(app)/templates/new/page'

beforeEach(() => {
  state.client = databaseFixture({
    time_entries: ['A', 'B'].map(org_id => ({ id: `entry-${org_id}`, org_id, work_date: '2026-10-05', minutes: 60, billable: true, rate_satang: 100, project_id: `project-${org_id}`, user_id: null, projects: { name: `ENTRY_PROJECT_${org_id}` } })),
    projects: ['A', 'B'].map(org_id => ({ id: `project-${org_id}`, org_id, name: `PROJECT_${org_id}` })),
    template_categories: ['A', 'B'].map(org_id => ({ id: `cat-${org_id}`, org_id, name: `CATEGORY_${org_id}`, slug: `cat-${org_id}` })),
    automation_templates: ['A', 'B'].map(org_id => ({ id: `tpl-${org_id}`, org_id, name: `TEMPLATE_${org_id}`, description: null, internal_value_satang: 0, price_satang: 0, reusable_notes: null, implementation_checklist: [], tags: [], category_id: `cat-${org_id}` })),
  })
})

it('timesheets list entries and project choices from the active workspace only', async () => {
  const content = pageContent(await TimesheetsPage())
  expect(content).toContain('PROJECT_A')
  expect(content).toContain('ENTRY_PROJECT_A')
  expect(content).not.toContain('PROJECT_B')
})

it.each([
  ['library', () => TemplatesPage()],
  ['new template categories', () => NewTemplatePage()],
  ['edit template categories', () => EditTemplatePage({ params: Promise.resolve({ id: 'tpl-A' }) })],
])('templates %s show only the active workspace', async (_name, render) => {
  const content = pageContent(await render())
  expect(content).toContain('CATEGORY_A')
  expect(content).not.toContain('CATEGORY_B')
  expect(content).not.toContain('TEMPLATE_B')
})

it.each([
  ['detail', TemplateDetailPage],
  ['edit', EditTemplatePage],
])('another workspace template %s returns not found', async (_name, render) => {
  await expect(render({ params: Promise.resolve({ id: 'tpl-B' }) })).rejects.toThrow('NOT_FOUND')
})

it('month tiles total every entry this month, not just the 100 rows in the table', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-16T05:00:00Z'))
  state.client = databaseFixture({
    time_entries: Array.from({ length: 120 }, (_, i) => ({ id: `e${i}`, org_id: 'A', work_date: '2026-10-05', minutes: 60, billable: false, rate_satang: null, project_id: 'project-A', user_id: null, projects: { name: 'P' } })),
    projects: [],
  })
  try {
    expect(pageContent(await TimesheetsPage())).toContain('120.0h')
  } finally {
    vi.useRealTimers()
  }
})

it.each([0, 0.001, 25])('logging %s hours is rejected before any write', async hours => {
  expect(await logTime({ project_id: 'project-A', hours })).toEqual({ error: 'Invalid input' })
})

it.each(['time_entries','projects'])('a failed %s read cannot show invented zero hours', async table => {
  const client = state.client as ReturnType<typeof databaseFixture>
  state.client = { from: (t: string) => {
    const q = client.from(t)
    if (t === table) q.then = (resolve, reject) => Promise.resolve({ data: null, error: { message: 'Unavailable' } }).then(resolve, reject)
    return q
  } }
  await expect(TimesheetsPage()).rejects.toThrow('Timesheet data unavailable')
})
