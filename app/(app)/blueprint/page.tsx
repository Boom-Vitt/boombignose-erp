import type { Metadata } from "next"
import { getBlueprintOrgSummary } from "@/lib/blueprint/queries"
import { buildBlueprintScene } from "@/lib/blueprint/scene-data"
import { BlueprintViewer } from "@/components/blueprint/blueprint-viewer"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Blueprint · BoomBigNose ERP",
}

export default async function BlueprintPage() {
  const summary = await getBlueprintOrgSummary()
  const model = buildBlueprintScene(summary)

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <BlueprintViewer model={model} />
    </div>
  )
}
