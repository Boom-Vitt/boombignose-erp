import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

const TARGET_DIRS = [
  "app/(app)/blueprint",
  "app/blueprint-preview",
  "components/blueprint",
  "lib/blueprint",
]

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...collectSourceFiles(full))
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry) && entry !== "copy-check.test.ts") {
      out.push(full)
    }
  }
  return out
}

const EMOJI_REGEX = /\p{Extended_Pictographic}/u

const BANNED_PHRASES: RegExp[] = [
  /\brevolutionize\b/i,
  /\bseamless\b/i,
  /\bunlock\b/i,
  /ปฏิวัติ/,
  /ยกระดับ/,
]

const FORBIDDEN_CLAIMS: { label: string; pattern: RegExp }[] = [
  {
    label: "tax/statutory compliance",
    pattern: /\b(tax[- ]compliant|statutory[- ]compliant|statutory tax invoice|ใบกำกับภาษีเต็มรูป)\b/i,
  },
  {
    label: "Odoo parity",
    pattern: /\bodoo\b/i,
  },
  {
    label: "customer readiness",
    pattern: /\b(customer[- ]ready|production[- ]ready for customers|sme[- ]ready)\b/i,
  },
  {
    label: "open source",
    pattern: /\b(open[- ]source|open[- ]core|agpl|mit license)\b/i,
  },
  {
    label: "customer counts",
    pattern: /\b\d+\+?\s*(customers|companies|teams|businesses)\s+(trust|using|rely)\b/i,
  },
  {
    label: "uptime claims",
    pattern: /\b99(\.\d+)?%\s*uptime\b|\buptime\s*sla\b/i,
  },
  {
    label: "LINE sending from the ERP",
    pattern: /\b(sends?\s+line\s+messages?|line\s+messaging\s+built[- ]in|ส่ง\s*line\s*จากระบบ)\b/i,
  },
  {
    label: "Live campus",
    pattern: /\blive\s+campus\b|\bcampus\s+live\b/i,
  },
  {
    label: "AI agents in the ERP",
    pattern: /\bai\s+agents?\b/i,
  },
]

describe("blueprint copy check", () => {
  it("blueprint copy has no emoji, banned phrases or forbidden claims", () => {
    const files = TARGET_DIRS.flatMap((rel) => collectSourceFiles(join(ROOT, rel)))
    expect(files.length).toBeGreaterThan(0)

    const violations: string[] = []

    for (const file of files) {
      const rel = relative(ROOT, file)
      const content = readFileSync(file, "utf8")

      if (EMOJI_REGEX.test(content)) {
        violations.push(`${rel}: contains emoji`)
      }

      for (const phrase of BANNED_PHRASES) {
        if (phrase.test(content)) {
          violations.push(`${rel}: contains banned phrase ${phrase}`)
        }
      }

      for (const claim of FORBIDDEN_CLAIMS) {
        if (claim.pattern.test(content)) {
          violations.push(`${rel}: contains forbidden claim (${claim.label})`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
