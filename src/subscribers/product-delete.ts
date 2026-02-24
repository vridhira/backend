/**
 * Subscriber: product.deleted → deleteProductsFromAlgoliaWorkflow
 *
 * Triggered whenever a product is deleted in Medusa admin.
 * The product is removed from Algolia so search results stay accurate.
 */
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { deleteProductsFromAlgoliaWorkflow } from "../workflows/delete-products-from-algolia"

export default async function handleProductDeleted({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  await deleteProductsFromAlgoliaWorkflow(container).run({
    input: {
      ids: [data.id],
    },
  })
}

export const config: SubscriberConfig = {
  event: "product.deleted",
}
