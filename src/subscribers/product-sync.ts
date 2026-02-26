/**
 * Subscriber: product.created, product.updated
 *
 * Buffers updated product IDs into a Redis set instead of calling the sync workflow
 * directly. The flush-search-buffer.ts scheduled job (every 30s) drains the set and
 * calls the workflow ONCE for all pending IDs as a batch.
 *
 * Benefits over the previous per-event direct-call approach:
 *   - 100 rapid product updates trigger 1 sync API call instead of 100
 *   - Subscriber returns immediately; no workflow latency blocks the event bus
 *   - A sync API failure retries the whole batch, not just one product
 */
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { getActiveProvider } from "../lib/search-config"
import { getRedisClient } from "../lib/redis-client"
import { SEARCH_BUFFER_KEY } from "../jobs/flush-search-buffer"
import logger from "../lib/logger"

const log = logger.child({ module: "product-sync-subscriber" })

export default async function handleProductEvents({
  event: { data },
}: SubscriberArgs<{ id: string }>) {
  const provider = getActiveProvider()

  // If no search engine is active, nothing to buffer.
  if (provider !== "algolia" && provider !== "meilisearch") return

  try {
    const redis = getRedisClient()
    await redis.sadd(SEARCH_BUFFER_KEY, data.id)
  } catch (err) {
    // Redis unavailable — log and continue. The product will re-enter the buffer on
    // its next update, or a full catalog resync can be triggered from admin.
    log.error({ err, productId: data.id }, "Could not buffer product ID for search sync")
  }
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}
