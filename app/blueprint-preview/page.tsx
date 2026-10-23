import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import {
  BLUEPRINT_FIXTURE_DATA,
  buildBlueprintScene,
} from "@/lib/blueprint/scene-data"
import { BlueprintViewer } from "@/components/blueprint/blueprint-viewer"

export const metadata: Metadata = {
  title: "Blueprint Preview · BoomBigNose ERP",
}

export default async function BlueprintPreviewPage() {
  await connection()
  if (process.env.ERP_BLUEPRINT_PREVIEW !== "1") {
    notFound()
  }

  const model = buildBlueprintScene(BLUEPRINT_FIXTURE_DATA)

  return (
    <main className="min-h-svh w-full max-w-full overflow-x-hidden bg-[#f6f3ec] p-2 sm:p-4">
      <BlueprintViewer model={model} />
    </main>
  )
}
