/**
 * Subscriber: product.created, product.updated
 *
 * Routes the sync to whichever search provider is currently active
 * (set via Admin → Search → Provider tab).
 */
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { syncProductsWorkflow } from "../workflows/sync-products"
import { syncProductsMeilisearchWorkflow } from "../workflows/sync-products-meilisearch"
import { getActiveProvider } from "../lib/search-config"

export default async function handleProductEvents({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const provider = getActiveProvider()

  if (provider === "algolia") {
    await syncProductsWorkflow(container).run({
      input: { filters: { id: data.id } },
    })
  } else if (provider === "meilisearch") {
    await syncProductsMeilisearchWorkflow(container).run({
      input: { filters: { id: data.id } },
    })
  }
  // "default" — no external indexing needed
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}
