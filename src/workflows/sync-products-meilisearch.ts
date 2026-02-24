import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"
import {
  syncProductsMeilisearchStep,
  SyncProductsMeilisearchStepInput,
} from "./steps/sync-products-meilisearch"
import { deleteProductsFromMeilisearchStep } from "./steps/delete-products-from-meilisearch"

type SyncProductsMeilisearchWorkflowInput = {
  filters?: Record<string, unknown>
  limit?: number
  offset?: number
}

export const syncProductsMeilisearchWorkflow = createWorkflow(
  "sync-products-meilisearch",
  ({ filters, limit, offset }: SyncProductsMeilisearchWorkflowInput) => {
    const { data: products, metadata } = useQueryGraphStep({
      entity: "product",
      fields: [
        "id",
        "title",
        "description",
        "handle",
        "thumbnail",
        "status",
        "categories.id",
        "categories.name",
        "categories.handle",
        "tags.id",
        "tags.value",
      ],
      pagination: { take: limit, skip: offset },
      filters,
    })

    const { publishedProducts, unpublishedIds } = transform({ products }, (data) => {
      const publishedProducts: SyncProductsMeilisearchStepInput["products"] = []
      const unpublishedIds: string[] = []

      data.products.forEach((p: any) => {
        if (p.status === "published") {
          const { status, ...rest } = p
          publishedProducts.push(rest as SyncProductsMeilisearchStepInput["products"][0])
        } else {
          unpublishedIds.push(p.id)
        }
      })
      return { publishedProducts, unpublishedIds }
    })

    syncProductsMeilisearchStep({ products: publishedProducts })
    deleteProductsFromMeilisearchStep({ ids: unpublishedIds })

    return new WorkflowResponse({ products, metadata } as any)
  }
)
