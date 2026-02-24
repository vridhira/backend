import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MEILISEARCH_MODULE } from "../../modules/meilisearch"
import MeilisearchModuleService from "../../modules/meilisearch/service"

export type DeleteProductsFromMeilisearchStepInput = { ids: string[] }

export const deleteProductsFromMeilisearchStep = createStep(
  "delete-products-from-meilisearch-step",
  async ({ ids }: DeleteProductsFromMeilisearchStepInput, { container }) => {
    if (!ids.length) return new StepResponse(undefined, [])

    const service: MeilisearchModuleService = container.resolve(MEILISEARCH_MODULE)
    const existing = (await service.retrieveFromIndex(ids, "product")).results.filter(Boolean)

    await service.deleteFromIndex(ids, "product")
    return new StepResponse(undefined, existing)
  },
  async (existing: Record<string, unknown>[] | undefined, { container }) => {
    if (!existing?.length) return
    const service: MeilisearchModuleService = container.resolve(MEILISEARCH_MODULE)
    await service.indexData(existing, "product")
  }
)
