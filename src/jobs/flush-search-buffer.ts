/**
 * Search Buffer Flush Job
 *
 * Runs every 30 seconds. Reads the Redis set "search:pending-products", atomically
 * drains it, and calls the appropriate sync workflow with all pending IDs as a single batch.
 *
 * The product-sync.ts subscriber no longer calls the workflow directly — it just
 * pushes product IDs into this set. This job is the ONLY writer from the buffer to
 * the search engine, which means:
 *   - Rapid product updates don't trigger N parallel sync workflows
 *   - A single workflow call indexes all updated products at once (cost-efficient)
 *   - Transient failures on individual products don't block other products
 *
 * Drain atomicity: A Lua script atomically SMEMBERS + DEL the pending set in one
 * Redis round-trip. IDs that arrive between the SMEMBERS and DEL would be missed
 * without the Lua script — they'd stay in the set until the next 30s cycle instead
 * of being lost.
 *
 * Rollback: If the sync workflow throws, all IDs are re-added to the set (best-effort)
 * so they are retried in the next 30s window.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { getActiveProvider } from "../lib/search-config"
import { getRedisClient } from "../lib/redis-client"
import { syncProductsWorkflow } from "../workflows/sync-products"
import { syncProductsMeilisearchWorkflow } from "../workflows/sync-products-meilisearch"
import logger from "../lib/logger"

const log = logger.child({ module: "flush-search-buffer" })

export const SEARCH_BUFFER_KEY = "search:pending-products"

// Atomically drain the pending-products set:
//   1. Get all members
//   2. Delete the key
//   3. Return the members
// Any IDs written AFTER the SMEMBERS call but BEFORE the DEL call are captured
// because the Lua VM pauses other commands while this runs.
const DRAIN_BUFFER_LUA = `
local members = redis.call('SMEMBERS', KEYS[1])
if #members > 0 then
  redis.call('DEL', KEYS[1])
end
return members
`

export default async function flushSearchBuffer(container: MedusaContainer) {
    let ids: string[] = []

    try {
        const redis = getRedisClient()
        const result = await (redis as any).eval(DRAIN_BUFFER_LUA, 1, SEARCH_BUFFER_KEY) as string[]
        ids = result ?? []
    } catch (redisErr) {
        // Redis unavailable — skip this cycle; the buffer will be drained next time.
        log.warn({ err: redisErr }, "Cannot read search buffer from Redis — skipping flush cycle")
        return
    }

    if (ids.length === 0) return

    log.info({ count: ids.length, ids }, "Flushing search buffer")

    const provider = getActiveProvider()

    try {
        if (provider === "algolia") {
            await syncProductsWorkflow(container).run({
                input: { filters: { id: ids } },
            })
        } else if (provider === "meilisearch") {
            await syncProductsMeilisearchWorkflow(container).run({
                input: { filters: { id: ids } },
            })
        } else {
            // No active search engine — nothing to sync; IDs are already drained.
            return
        }

        log.info({ count: ids.length, provider }, "Search buffer flush completed")
    } catch (syncErr) {
        // Sync failed — best-effort rollback: re-add IDs so they're retried next cycle.
        log.error({ err: syncErr, count: ids.length, provider }, "Search sync workflow failed — re-adding IDs to buffer for retry")

        try {
            const redis = getRedisClient()
            if (ids.length > 0) {
                await redis.sadd(SEARCH_BUFFER_KEY, ...ids)
            }
        } catch (rollbackErr) {
            // Redis unavailable for rollback — IDs will be lost for this cycle.
            // Products will eventually re-enter the buffer on their next update.
            log.error({ err: rollbackErr }, "Rollback failed — affected product IDs may miss this sync cycle")
        }
    }
}

export const config = {
    name: "flush-search-buffer",
    // Every 30 seconds — balances index freshness against API call frequency.
    // Adjust downwards (e.g. "*/10 * * * * *") if near-real-time is required.
    schedule: "*/30 * * * * *",
}
