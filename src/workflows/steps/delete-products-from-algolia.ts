import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ALGOLIA_MODULE } from "../../modules/algolia"
import AlgoliaModuleService from "../../modules/algolia/service"

export type DeleteProductsFromAlgoliaStepInput = {
  ids: string[]
}

export const deleteProductsFromAlgoliaStep = createStep(
  "delete-products-from-algolia-step",
  async ({ ids }: DeleteProductsFromAlgoliaStepInput, { container }) => {
    if (!ids.length) {
      return new StepResponse(undefined, [])
    }

    const algoliaModuleService: AlgoliaModuleService =
      container.resolve(ALGOLIA_MODULE)

    // Save existing records so we can restore them if this step is rolled back
    const existingRecords = (
      await algoliaModuleService.retrieveFromIndex(ids, "product")
    ).results.filter(Boolean)

    await algoliaModuleService.deleteFromIndex(ids, "product")

    return new StepResponse(undefined, existingRecords)
  },
  // Compensation: restore the deleted records
  async (
    existingRecords: Record<string, unknown>[] | undefined,
    { container }
  ) => {
    if (!existingRecords?.length) return

    const algoliaModuleService: AlgoliaModuleService =
      container.resolve(ALGOLIA_MODULE)

    await algoliaModuleService.indexData(
      existingRecords as unknown as Record<string, unknown>[],
      "product"
    )
  }
)
