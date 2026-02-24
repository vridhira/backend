import { createWorkflow } from "@medusajs/framework/workflows-sdk"
import { deleteProductsFromMeilisearchStep } from "./steps/delete-products-from-meilisearch"

export const deleteProductsFromMeilisearchWorkflow = createWorkflow(
  "delete-products-from-meilisearch",
  (input: { ids: string[] }) => {
    deleteProductsFromMeilisearchStep(input)
  }
)
