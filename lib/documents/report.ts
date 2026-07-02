import { formatTHB } from "@/lib/money"
import { escapeHtml } from "@/lib/documents/printable"
import type { Pivot, ProjectHours } from "@/lib/metrics/reports"

/**
 * Pure renderer for the printable Reports document. Mirrors the approach in
 * `printable.ts`: a self-contained HTML string (inline CSS, print-friendly)
 * that a route handler serves so the user prints it to PDF from the browser.
 * All interpolated text is HTML-escaped; money stays in integer satang until
 * the {@link formatTHB} presentation edge.
 */

export type ReportHoursSummary = {
  projects: ProjectHours[]
  totalMinutes: number
  billableMinutes: number
  totalHours: number
  billableHours: number
}

export type ReportData = {
  orgName: string
  /** Human label, e.g. "Generated 2026-07-02". */
  generatedAt: string
  /** Human label for the covered range, e.g. "2026-02 – 2026-07". */
  rangeLabel: string
  totalRevenueSatang: number
  /** Revenue by client (rows) × month (columns). */
  revenue: Pivot
  hours: ReportHoursSummary
}

/** Format hours with two decimals, e.g. 3.5 → "3.50 h". */
function fmtHours(hours: number): string {
  return `${hours.toFixed(2)} h`
}

function renderRevenueTable(revenue: Pivot): string {
  if (revenue.rowKeys.length === 0) {
    return `<p class="muted">No payments in this range.</p>`
  }

  const head = `<tr>
      <th>Client</th>
      ${revenue.colKeys
        .map((m) => `<th class="num">${escapeHtml(m)}</th>`)
        .join("\n      ")}
      <th class="num">Total</th>
    </tr>`

  const body = revenue.rowKeys
    .map(
      (client) => `<tr>
      <td>${escapeHtml(client)}</td>
      ${revenue.colKeys
        .map(
          (m) =>
            `<td class="num">${escapeHtml(formatTHB(revenue.cell(client, m)))}</td>`
        )
        .join("\n      ")}
      <td class="num strong">${escapeHtml(formatTHB(revenue.rowTotal(client)))}</td>
    </tr>`
    )
    .join("\n")

  const footer = `<tr class="totals-row">
      <td class="strong">Total</td>
      ${revenue.colKeys
        .map(
          (m) =>
            `<td class="num strong">${escapeHtml(formatTHB(revenue.colTotal(m)))}</td>`
        )
        .join("\n      ")}
      <td class="num strong">${escapeHtml(formatTHB(revenue.grandTotal))}</td>
    </tr>`

  return `<table>
      <thead>${head}</thead>
      <tbody>
        ${body}
        ${footer}
      </tbody>
    </table>`
}

function renderHoursTable(hours: ReportHoursSummary): string {
  if (hours.projects.length === 0) {
    return `<p class="muted">No time logged in this range.</p>`
  }

  const body = hours.projects
    .map(
      (p) => `<tr>
      <td>${escapeHtml(p.project_name)}</td>
      <td class="num">${escapeHtml(fmtHours(p.totalHours))}</td>
      <td class="num">${escapeHtml(fmtHours(p.billableHours))}</td>
      <td class="num">${escapeHtml(fmtHours(p.totalHours - p.billableHours))}</td>
    </tr>`
    )
    .join("\n")

  const footer = `<tr class="totals-row">
      <td class="strong">Total</td>
      <td class="num strong">${escapeHtml(fmtHours(hours.totalHours))}</td>
      <td class="num strong">${escapeHtml(fmtHours(hours.billableHours))}</td>
      <td class="num strong">${escapeHtml(
        fmtHours(hours.totalHours - hours.billableHours)
      )}</td>
    </tr>`

  return `<table>
      <thead>
        <tr>
          <th>Project</th>
          <th class="num">Total</th>
          <th class="num">Billable</th>
          <th class="num">Non-billable</th>
        </tr>
      </thead>
      <tbody>
        ${body}
        ${footer}
      </tbody>
    </table>`
}

export function renderReportHtml(data: ReportData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Operational report — ${escapeHtml(data.orgName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #18181b; margin: 0; padding: 40px; }
  .doc { max-width: 880px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 16px; margin: 32px 0 8px; }
  .org { font-size: 15px; font-weight: 600; }
  .range { font-size: 12px; color: #71717a; }
  .stats { display: flex; gap: 12px; margin: 16px 0 8px; flex-wrap: wrap; }
  .stat { border: 1px solid #e4e4e7; border-radius: 10px; padding: 12px 16px; min-width: 180px; }
  .stat .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #71717a; }
  .stat .value { font-size: 20px; font-weight: 700; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 13px; }
  th { text-align: left; border-bottom: 2px solid #18181b; padding: 8px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #3f3f46; }
  td { padding: 8px 6px; border-bottom: 1px solid #e4e4e7; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .strong { font-weight: 700; }
  .totals-row td { border-top: 2px solid #18181b; }
  .muted { color: #a1a1aa; padding: 8px 0; }
  footer { margin-top: 40px; font-size: 11px; color: #a1a1aa; text-align: center; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="doc">
    <header>
      <div>
        <h1>Operational report</h1>
        <div class="org">${escapeHtml(data.orgName)}</div>
        <div class="range">${escapeHtml(data.rangeLabel)} · ${escapeHtml(
          data.generatedAt
        )}</div>
      </div>
    </header>

    <div class="stats">
      <div class="stat">
        <div class="label">Total revenue</div>
        <div class="value">${escapeHtml(formatTHB(data.totalRevenueSatang))}</div>
      </div>
      <div class="stat">
        <div class="label">Billable hours</div>
        <div class="value">${escapeHtml(fmtHours(data.hours.billableHours))}</div>
      </div>
      <div class="stat">
        <div class="label">Total hours</div>
        <div class="value">${escapeHtml(fmtHours(data.hours.totalHours))}</div>
      </div>
    </div>

    <h2>Revenue by client × month</h2>
    ${renderRevenueTable(data.revenue)}

    <h2>Hours by project</h2>
    ${renderHoursTable(data.hours)}

    <footer>Generated by BoomBigNose Company OS · Operational report, not a legal document.</footer>
  </div>
</body>
</html>`
}
