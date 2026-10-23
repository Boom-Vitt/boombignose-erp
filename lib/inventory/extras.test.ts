import { expect, it } from "vitest"
import { TransferInput } from "./schema"

const command = { product_id: "a0000000-0000-0000-0000-000000000001", from_warehouse_id: "a0000000-0000-0000-0000-000000000002", to_warehouse_id: "a0000000-0000-0000-0000-000000000003", quantity: 0.001, reason: "Relocate", key: "be510000-0000-4000-8000-000000000060" }
it("accepts seeded database GUIDs and fractional transfers", () => { expect(TransferInput.parse(command)).toEqual(command) })
it("refuses same-warehouse, empty and overprecision transfers", () => {
  expect(TransferInput.safeParse({ ...command, to_warehouse_id: command.from_warehouse_id }).success).toBe(false)
  for (const quantity of [0, -1, NaN, 0.0001]) expect(TransferInput.safeParse({ ...command, quantity }).success).toBe(false)
})
