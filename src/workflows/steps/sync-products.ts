import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ALGOLIA_MODULE } from "../../modules/algolia"
import AlgoliaModuleService from "../../modules/algolia/service"

export type SyncProductsStepInput = {
  products: {
    id: string
    title: string
    description?: string | null
    handle: string
    thumbnail?: string | null
    categories: {
      id: string
      name: string
      handle: string
    }[]
    tags: {
      id: string
      value: string
    }[]
  }[]
}

export const syncProductsStep = createStep(
  "sync-products-step",
  async ({ products }: SyncProductsStepInput, { container }) => {
    if (!products.length) {
      return new StepResponse(undefined, { newProducts: [], existingProducts: [] })
    }

    const algoliaModuleService: AlgoliaModuleService =
      container.resolve(ALGOLIA_MODULE)

    const existingProducts = (
      await algoliaModuleService.retrieveFromIndex(
        products.map((p) => p.id),
        "product"
      )
    ).results.filter(Boolean)

    const newProducts = products.filter(
      (p) => !existingProducts.some((e) => e.objectID === p.id)
    )

    await algoliaModuleService.indexData(
      products as unknown as Record<string, unknown>[],
      "product"
    )

    return new StepResponse(undefined, {
      newProducts: newProducts.map((p) => p.id),
      existingProducts,
    })
  },
  // Compensation: remove newly added products and restore updated ones
  async (
    data: { newProducts: string[]; existingProducts: Record<string, unknown>[] } | undefined,
    { container }
  ) => {
    if (!data) return

    const algoliaModuleService: AlgoliaModuleService =
      container.resolve(ALGOLIA_MODULE)

    // Remove products that were newly created (not existed before)
    if (data.newProducts.length) {
      await algoliaModuleService.deleteFromIndex(data.newProducts, "product")
    }

    // Restore products that were updated back to their previous values
    if (data.existingProducts.length) {
      await algoliaModuleService.indexData(
        data.existingProducts as unknown as Record<string, unknown>[],
        "product"
      )
    }
  }
)
