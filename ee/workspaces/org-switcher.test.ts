import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

vi.mock('@/ee/workspaces/actions', () => ({ setActiveOrg: vi.fn() }))
// A portal renders no popup during SSR. Render that boundary inline so the real
// Base UI group/label/item components exercise the switcher's popup content.
vi.mock('@/components/ui/dropdown-menu', async importOriginal => ({
 ...await importOriginal<typeof import('@/components/ui/dropdown-menu')>(),
 DropdownMenuContent: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
}))

import { OrgSwitcher } from '@/ee/workspaces/components/org-switcher'
import { SidebarProvider } from '@/components/ui/sidebar'

it('multiple workspace options render without missing the menu label context', () => {
 const html = renderToStaticMarkup(createElement(SidebarProvider, null,
  createElement(OrgSwitcher, {
   currentOrgId:'A',
   orgs:[{orgId:'A',orgName:'Workspace Alpha',role:'owner'},{orgId:'B',orgName:'Workspace Beta',role:'member'}],
  }),
 ))
 expect(html).toContain('Workspaces')
 expect(html).toContain('Workspace Alpha')
 expect(html).toContain('Workspace Beta')
 expect(html).toContain('role="group"')
})

it('one workspace renders its label without offering a switch menu', () => {
 const html = renderToStaticMarkup(createElement(SidebarProvider, null,
  createElement(OrgSwitcher, {currentOrgId:'A',orgs:[{orgId:'A',orgName:'Workspace Alpha',role:'owner'}]}),
 ))
 expect(html).toContain('Workspace Alpha')
 expect(html).not.toContain('Switch workspace')
})
