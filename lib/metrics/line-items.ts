import { sumSatang, type Satang } from "@/lib/money"

/**
 * Line-item math shared by quotes and invoices. Money stays integer satang;
 * quantity may be fractional (e.g. 1.5 hours), so the line amount is rounded to
 * the nearest satang exactly once, here, at computation time.
 */

export type LineItemInput = {
  quantity: number
  unit_price_satang: Satang
}

export type LineItemAmount = { amount_satang: Satang }

/** amount = round(quantity × unit price). Never a float in storage. */
export function lineAmountSatang(
  quantity: number,
  unitPriceSatang: Satang
): Satang {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPriceSatang)) return 0
  return Math.round(quantity * unitPriceSatang)
}

/** Attach the computed amount to a raw line input. */
export function withLineAmount<T extends LineItemInput>(
  item: T
): T & LineItemAmount {
  return { ...item, amount_satang: lineAmountSatang(item.quantity, item.unit_price_satang) }
}

/** Subtotal = Σ line amounts. Accepts either raw inputs or rows carrying amount_satang. */
export function subtotalSatang(
  items: Array<LineItemInput | LineItemAmount>
): Satang {
  return sumSatang(
    items.map((i) =>
      "amount_satang" in i
        ? i.amount_satang
        : lineAmountSatang(i.quantity, i.unit_price_satang)
    )
  )
}

/**
 * Document total = subtotal − discount, floored at 0. Discount is an absolute
 * satang amount (not a percentage), matching the quotes.discount_satang column.
 */
export function documentTotalSatang(
  subtotal: Satang,
  discountSatang: Satang = 0
): Satang {
  return Math.max(0, subtotal - Math.max(0, discountSatang))
}
