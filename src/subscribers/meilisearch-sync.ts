/**
 * Subscriber: meilisearch.sync → full product reindex into Meilisearch
 *
 * Triggered by POST /admin/search/sync when the active provider is meilisearch.
 */
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { syncProductsMeilisearchWorkflow } from "../workflows/sync-products-meilisearch"

export default async function meilisearchSyncHandler({ container }: SubscriberArgs) {
  const logger = container.resolve("logger")

  let hasMore = true
  let offset = 0
  const limit = 50
  let totalIndexed = 0

  logger.info("[Meilisearch] Starting full product reindex…")

  while (hasMore) {
    const {
      result: { products, metadata },
    } = await syncProductsMeilisearchWorkflow(container).run({
      input: { limit, offset },
    })

    hasMore = offset + limit < (metadata?.count ?? 0)
    offset += limit
    totalIndexed += (products as any[]).length
  }

  logger.info(`[Meilisearch] Full reindex complete — ${totalIndexed} products indexed.`)
}

export const config: SubscriberConfig = {
  event: "meilisearch.sync",
}
