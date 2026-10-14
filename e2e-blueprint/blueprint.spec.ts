import { test, expect } from "@playwright/test"

const CALLOUT_NUMBERS = ["01", "02", "03", "04", "05", "06", "07", "08"]

test("canvas draws non-blank pixels with no console errors", async ({ page }) => {
  const errors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text())
    }
  })
  page.on("pageerror", (err) => {
    errors.push(err.message)
  })

  await page.goto("/blueprint-preview")
  const root = page.getByTestId("blueprint-root")
  await expect(root).toHaveAttribute("data-webgl", "active")
  await expect(page.getByTestId("sheet-indicator")).toContainText("sheet 1/4")

  const canvas = page.locator("canvas").first()
  await expect(canvas).toBeVisible()

  // Verify the WebGL canvas has non-blank / multi-tone drawn pixels
  const pixelStats = await page.evaluate(() => {
    const cv = document.querySelector("canvas")
    if (!cv || cv.width === 0 || cv.height === 0) {
      return { ok: false, distinctColors: 0, width: 0, height: 0 }
    }
    const gl =
      (cv.getContext("webgl2") as WebGL2RenderingContext | null) ||
      (cv.getContext("webgl") as WebGLRenderingContext | null)
    if (!gl) {
      return { ok: false, distinctColors: 0, width: cv.width, height: cv.height }
    }
    const w = gl.drawingBufferWidth
    const h = gl.drawingBufferHeight
    const buf = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    const colors = new Set<string>()
    const stride = Math.max(4, Math.floor((w * h) / 2500) * 4)
    for (let i = 0; i < buf.length - 4; i += stride) {
      const r = buf[i]
      const g = buf[i + 1]
      const b = buf[i + 2]
      const a = buf[i + 3]
      if (a > 0) {
        colors.add(`${r},${g},${b}`)
      }
      if (colors.size > 3) break
    }
    return { ok: colors.size > 1, distinctColors: colors.size, width: w, height: h }
  })

  expect(pixelStats.width).toBeGreaterThan(0)
  expect(pixelStats.height).toBeGreaterThan(0)
  expect(pixelStats.distinctColors).toBeGreaterThan(1)
  expect(errors).toEqual([])
})

test("every callout opens its detail by click and keyboard", async ({ page }) => {
  await page.goto("/blueprint-preview")

  for (const num of CALLOUT_NUMBERS) {
    const btn = page.getByTestId(`callout-${num}`)
    await expect(btn).toBeVisible()
    await btn.click()
    await expect(page.getByTestId("detail-title")).toContainText(num)
    await expect(page.getByTestId("detail-rule-en")).not.toBeEmpty()

    // Close with Escape
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("detail-title")).toHaveCount(0)

    // Activate via keyboard (focus + Enter or Space)
    await btn.focus()
    await page.keyboard.press(num === "02" || num === "04" ? "Space" : "Enter")
    await expect(page.getByTestId("detail-title")).toContainText(num)
  }
})

test("reduced motion shows a static exploded view", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/blueprint-preview")

  const root = page.getByTestId("blueprint-root")
  await expect(root).toHaveAttribute("data-reduced-motion", "true")
  await expect(root).toHaveAttribute("data-exploded", "true")
  await expect(page.getByTestId("reduced-motion-badge")).toBeVisible()
})

test("no WebGL shows the fallback with all text", async ({ page }) => {
  await page.addInitScript(() => {
    const origGetContext = HTMLCanvasElement.prototype.getContext
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(HTMLCanvasElement.prototype as any).getContext = function (
      type: string,
      ...args: unknown[]
    ) {
      if (
        type === "webgl" ||
        type === "webgl2" ||
        type === "experimental-webgl"
      ) {
        return null
      }
      return origGetContext.apply(this, [type as never, ...(args as [])])
    }
  })

  await page.goto("/blueprint-preview")

  const root = page.getByTestId("blueprint-root")
  await expect(root).toHaveAttribute("data-webgl", "fallback")
  await expect(page.getByTestId("blueprint-webgl-fallback")).toBeVisible()

  for (const num of CALLOUT_NUMBERS) {
    await expect(page.getByTestId(`callout-${num}`)).toBeVisible()
  }

  await page.getByTestId("callout-05").click()
  await expect(page.getByTestId("detail-rule-en")).toContainText("pending-only")

  await page.keyboard.press("Escape")
  await expect(page.getByTestId("detail-title")).toHaveCount(0)
})

test("no horizontal overflow at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/blueprint-preview")

  await expect(page.getByTestId("blueprint-root")).toBeVisible()

  const overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth
    const scrollWidth = document.documentElement.scrollWidth
    return { docWidth, scrollWidth, overflows: scrollWidth > docWidth }
  })

  expect(overflow.overflows).toBe(false)
})
