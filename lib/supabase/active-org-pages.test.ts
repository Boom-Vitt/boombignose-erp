import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseFixture, pageContent } from './__tests__/tenant-fixture'

vi.mock('server-only', () => ({}))
const state = vi.hoisted(() => ({ orgId: 'A', client: {} as unknown }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('No service role for business reads') } }))
vi.mock('@/lib/auth', () => ({ requireOrgContext: async () => ({ userId: 'user', orgId: state.orgId, role: 'owner' }) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') }, redirect: vi.fn(), useRouter: vi.fn(), useSearchParams: vi.fn(), usePathname: () => '' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import ClientsPage from '@/app/(app)/clients/page'
import ClientDetailPage from '@/app/(app)/clients/[id]/page'
import EditClientPage from '@/app/(app)/clients/[id]/edit/page'
import DealsPage from '@/app/(app)/deals/page'
import DealDetailPage from '@/app/(app)/deals/[id]/page'
import EditDealPage from '@/app/(app)/deals/[id]/edit/page'
import NewDealPage from '@/app/(app)/deals/new/page'
import { addActivity } from '@/app/(app)/deals/actions'
import { GET as exportDeals } from '@/app/(app)/deals/export/route'
import { currentMonthKey } from '@/lib/dates'
import { getDashboardData } from '@/lib/queries/dashboard'

beforeEach(() => {
  state.orgId = 'A'
  const date = `${currentMonthKey()}-05`
  state.client = databaseFixture({
    clients: ['A','B'].map(org_id => ({ id: `client-${org_id}`, org_id, name: `CLIENT_${org_id}`, created_at: '2026-10-01' })),
    deals: ['A','B'].map(org_id => ({ id: `deal-${org_id}`, org_id, title: `DEAL_${org_id}`, stage: 'lead', value_satang: org_id === 'A' ? 100 : 999, client_id: `client-${org_id}`, created_at: '2026-10-01' })),
    activities: ['A','B'].map(org_id => ({ id: `activity-${org_id}`, org_id, body: `ACTIVITY_${org_id}`, type: 'note', client_id: 'client-A', deal_id: 'deal-A', done: false, due_date: '2026-10-01' })),
    contacts: ['A','B'].map(org_id => ({ id: `contact-${org_id}`, org_id, name: `CONTACT_${org_id}`, client_id: 'client-A' })),
    org_settings: ['A','B'].map(org_id => ({ org_id, cash_balance_satang: org_id === 'A' ? 500 : 800 })),
    invoices: ['A','B'].map(org_id => ({id:`invoice-${org_id}`,org_id,status:'sent',amount_satang:org_id==='A'?1000:3000,due_date:'2000-01-01',is_recurring:true,recurring_interval:'monthly'})),
    payments: ['A','B'].map(org_id => ({org_id,invoice_id:`invoice-${org_id}`,amount_satang:org_id==='A'?100:500,paid_at:date,verification_state:'verified'})).concat([{org_id:'A',invoice_id:'invoice-A',amount_satang:777,paid_at:date,verification_state:'legacy_unverified'}]),
    costs: ['A','B'].map(org_id => ({org_id,amount_satang:org_id==='A'?300:900,incurred_on:date})),
    subscriptions: ['A','B'].map(org_id => ({org_id,status:'active',amount_satang:org_id==='A'?600:1800,interval:'monthly'})),
    time_entries: ['A','B'].map(org_id => ({org_id,project_id:`project-${org_id}`,minutes:org_id==='A'?60:180,billable:true,rate_satang:100,work_date:date})),
    projects: [{ org_id: 'A', status: 'in_progress' },{ org_id: 'B', status: 'in_progress' }],
    saved_views: ['A','B'].map(org_id => ({ id: org_id, org_id, user_id: 'user', module: 'deals', name: `VIEW_${org_id}`, config: {} })),
    quotes: ['A','B'].map(org_id => ({ org_id, status: 'sent', total_satang: org_id === 'A' ? 200 : 1000 })),
  })
})

describe('active workspace business reads', () => {
  it.each([
    ['clients', () => ClientsPage({ searchParams: Promise.resolve({}) }), 'CLIENT'],
    ['deals', () => DealsPage({ searchParams: Promise.resolve({}) }), 'DEAL'],
    ['new deal client selector', () => NewDealPage(), 'CLIENT'],
    ['edit deal client selector', () => EditDealPage({ params: Promise.resolve({ id: 'deal-A' }) }), 'CLIENT'],
  ])('%s show only the active workspace', async (_name, render, marker) => {
    const content = pageContent(await render())
    expect(content).toContain(`${marker}_A`)
    expect(content).not.toContain(`${marker}_B`)
  })

  it('switching workspaces changes list results', async () => {
    state.orgId = 'B'
    const content = pageContent(await ClientsPage({ searchParams: Promise.resolve({}) }))
    expect(content).toContain('CLIENT_B')
    expect(content).not.toContain('CLIENT_A')
  })

  it.each([
    ['client detail', ClientDetailPage, 'client-B'],
    ['client edit', EditClientPage, 'client-B'],
    ['deal detail', DealDetailPage, 'deal-B'],
    ['deal edit', EditDealPage, 'deal-B'],
  ])('direct inactive workspace navigation to %s returns not found', async (_name, render, id) => {
    await expect(render({ params: Promise.resolve({ id }) })).rejects.toThrow('NOT_FOUND')
  })

  it('client children and deal views remain in the active workspace', async () => {
    const content = pageContent(await ClientDetailPage({ params: Promise.resolve({ id: 'client-A' }) }))
    expect(content).toContain('CONTACT_A')
    expect(content).not.toContain('CONTACT_B')
    expect(content).not.toContain('ACTIVITY_B')
    expect(pageContent(await DealsPage({ searchParams: Promise.resolve({}) }))).not.toContain('VIEW_B')
  })

  it('dashboard totals use only the active workspace', async () => {
    const a = await getDashboardData()
    expect(a.pipelineSatang).toBe(100)
    expect(a.openQuotesValueSatang).toBe(200)
    expect(a.activeProjectCount).toBe(1)
    expect(a.cashSatang).toBe(500)
    expect(a.monthlyRevenueSatang).toBe(100)
    expect(a.monthlyBurnSatang).toBe(300)
    expect(a.unpaidSatang).toBe(900)
    expect(a.unpaidInvoiceCount).toBe(1)
    expect(a.overdueInvoiceCount).toBe(1)
    expect(a.mrrSatang).toBe(600)
    expect(a.invoiceMrrSatang).toBe(1000)
    expect(a.billableHoursThisMonth).toBe(1)
    expect(a.billableValueThisMonthSatang).toBe(100)
    expect(a.overdueFollowUps).toHaveLength(1)
    state.orgId = 'B'
    const b = await getDashboardData()
    expect(b.pipelineSatang).toBe(999)
    expect(b.openQuotesValueSatang).toBe(1000)
    expect(b.cashSatang).toBe(800)
    expect(b.monthlyRevenueSatang).toBe(500)
    expect(b.unpaidSatang).toBe(2500)
    expect(b.mrrSatang).toBe(1800)
    expect(b.billableHoursThisMonth).toBe(3)
  })
})

it('an inactive deal cannot create an activity in the active workspace', async () => {
 const id = '00000000-0000-4000-8000-000000000011'
 const activities: Record<string,unknown>[] = []
 state.client = databaseFixture({deals:[{id,org_id:'B',client_id:'client-B'}],activities})
 expect(await addActivity({dealId:id,type:'note',body:'Wrong workspace'})).toEqual({error:'Deal not found in the active workspace'})
 expect(activities).toHaveLength(0)
})
it('a failed dashboard query cannot report invented zero balances', async () => {
 const client = state.client as ReturnType<typeof databaseFixture>
 state.client = {from: (table:string) => table === 'costs'
   ? {select: () => ({eq: async () => ({data:null,error:{message:'Unavailable'}})})}
   : client.from(table)}
 await expect(getDashboardData()).rejects.toThrow('Unable to load dashboard data')
})

it('deal exports contain only the active workspace and its client names',async()=>{
 const a=await (await exportDeals(new Request('https://app.example.test/deals/export'))).text()
 expect(a).toContain('DEAL_A');expect(a).toContain('CLIENT_A');expect(a).not.toContain('DEAL_B')
 state.orgId='B'
 const b=await (await exportDeals(new Request('https://app.example.test/deals/export'))).text()
 expect(b).toContain('DEAL_B');expect(b).toContain('CLIENT_B');expect(b).not.toContain('DEAL_A')
})
