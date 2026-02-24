/**
 * Subscriber: algolia.sync → full product reindex
 *
 * Triggered by POST /admin/algolia/sync (or manually via the Algolia admin page).
 * Paginates through ALL products in batches of 50 and indexes them all.
 */
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { syncProductsWorkflow } from "../workflows/sync-products"

export default async function algoliaSyncHandler({
  container,
}: SubscriberArgs) {
  const logger = container.resolve("logger")

  let hasMore = true
  let offset = 0
  const limit = 50
  let totalIndexed = 0

  logger.info("[Algolia] Starting full product reindex…")

  while (hasMore) {
    const {
      result: { products, metadata },
    } = await syncProductsWorkflow(container).run({
      input: { limit, offset },
    })

    hasMore = offset + limit < (metadata?.count ?? 0)
    offset += limit
    totalIndexed += (products as any[]).length
  }

  logger.info(`[Algolia] Full reindex complete — ${totalIndexed} products indexed.`)
}

export const config: SubscriberConfig = {
  event: "algolia.sync",
}
