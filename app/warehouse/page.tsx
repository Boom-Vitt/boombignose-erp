import type { Metadata } from "next"

import { WarehouseApp } from "@/components/warehouse/warehouse-app"

export const metadata: Metadata = { title: "Campus 3D · BoomBigNose" }

export default function WarehousePage() {
  return <WarehouseApp />
}
