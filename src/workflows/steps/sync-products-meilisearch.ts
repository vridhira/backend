import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MEILISEARCH_MODULE } from "../../modules/meilisearch"
import MeilisearchModuleService from "../../modules/meilisearch/service"

export type SyncProductsMeilisearchStepInput = {
  products: {
    id: string
    title: string
    description?: string | null
    handle: string
    thumbnail?: string | null
    categories: { id: string; name: string; handle: string }[]
    tags: { id: string; value: string }[]
  }[]
}

export const syncProductsMeilisearchStep = createStep(
  "sync-products-meilisearch-step",
  async ({ products }: SyncProductsMeilisearchStepInput, { container }) => {
    if (!products.length) {
      return new StepResponse(undefined, { newProducts: [], existingProducts: [] })
    }

    const service: MeilisearchModuleService = container.resolve(MEILISEARCH_MODULE)

    const existingResult = await service.retrieveFromIndex(
      products.map((p) => p.id),
      "product"
    )
    const existingIds = new Set(existingResult.results.map((r: any) => r.id as string))
    const newProducts = products.filter((p) => !existingIds.has(p.id))

    await service.indexData(
      products as unknown as Record<string, unknown>[],
      "product"
    )

    return new StepResponse(undefined, {
      newProducts: newProducts.map((p) => p.id),
      existingProducts: existingResult.results,
    })
  },
  // Compensation: remove newly added products, restore updated ones
  async (
    data: { newProducts: string[]; existingProducts: Record<string, unknown>[] } | undefined,
    { container }
  ) => {
    if (!data) return
    const service: MeilisearchModuleService = container.resolve(MEILISEARCH_MODULE)

    if (data.newProducts.length) {
      await service.deleteFromIndex(data.newProducts, "product")
    }
    if (data.existingProducts.length) {
      await service.indexData(
        data.existingProducts as Record<string, unknown>[],
        "product"
      )
    }
  }
)
