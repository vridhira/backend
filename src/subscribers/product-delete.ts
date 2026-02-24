/**
 * Subscriber: product.deleted
 *
 * Routes deletion to whichever search provider is currently active.
 */
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { deleteProductsFromAlgoliaWorkflow } from "../workflows/delete-products-from-algolia"
import { deleteProductsFromMeilisearchWorkflow } from "../workflows/delete-products-from-meilisearch"
import { getActiveProvider } from "../lib/search-config"

export default async function handleProductDeleted({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const provider = getActiveProvider()

  if (provider === "algolia") {
    await deleteProductsFromAlgoliaWorkflow(container).run({
      input: { ids: [data.id] },
    })
  } else if (provider === "meilisearch") {
    await deleteProductsFromMeilisearchWorkflow(container).run({
      input: { ids: [data.id] },
    })
  }
}

export const config: SubscriberConfig = {
  event: "product.deleted",
}
