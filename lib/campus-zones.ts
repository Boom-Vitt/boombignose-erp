/** HQ office zones in the 3D campus. Pure data so the zone → 2D route mapping is testable without three.js. */
export interface ZoneDef {
  id: string
  name: string
  sub: string
  rect: [number, number, number, number]
  color: string
  /** [label, 2D route]; the first entry is where clicking the zone in 3D goes. */
  links: [string, string][]
}

export const ZONES: ZoneDef[] = [
  { id: "sales", name: "Sales floor", sub: "Clients & Deals", rect: [44, -28, 60, -11], color: "#dbe7fb", links: [["Deals", "/deals"], ["Clients", "/clients"]] },
  { id: "studio", name: "Project studio", sub: "Projects & Timesheets", rect: [60, -28, 76, -11], color: "#f3e8d8", links: [["Projects", "/projects"], ["Timesheets", "/timesheets"]] },
  { id: "reception", name: "Reception", sub: "Client intake", rect: [44, -11, 50, -5], color: "#e3f3ea", links: [["Intake", "/intake"]] },
  { id: "servers", name: "Server room", sub: "Automations", rect: [72, -11, 76, -5], color: "#e2e6ee", links: [["Automation", "/automation"]] },
  { id: "meeting", name: "Meeting room", sub: "Calendar", rect: [44, -5, 54, 8], color: "#ead9c3", links: [["Calendar", "/calendar"]] },
  { id: "founder", name: "Founder office", sub: "Dashboard & Reports", rect: [54, -5, 64, 8], color: "#e4d3bb", links: [["Dashboard", "/dashboard"], ["Reports", "/reports"]] },
  { id: "finance", name: "Finance", sub: "Invoices & Quotes", rect: [64, -5, 76, 8], color: "#dcf2ea", links: [["Finance", "/finance"], ["Quotes", "/quotes"]] },
]

/** Primary 2D module for a zone, or null when the id is not a zone (forklift, truck, person). */
export function zoneLink(id: string | null): { label: string; href: string } | null {
  const link = ZONES.find((z) => z.id === id)?.links[0]
  return link ? { label: link[0], href: link[1] } : null
}
