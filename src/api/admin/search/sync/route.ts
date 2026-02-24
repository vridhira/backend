/**
 * POST /admin/search/sync
 *
 * Triggers a full reindex for the currently active search provider.
 * body (optional): { provider: "algolia"|"meilisearch" } — overrides active provider for this run
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getActiveProvider, SearchProvider } from "../../../../lib/search-config"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const bodyProvider = (req.body as any)?.provider as SearchProvider | undefined
  const provider = bodyProvider ?? getActiveProvider()

  if (provider === "default") {
    return res.json({ message: "Default provider does not require indexing." })
  }

  const eventBus = req.scope.resolve(Modules.EVENT_BUS) as any
  await eventBus.emit({
    name: `${provider}.sync`,
    data: {},
  })

  return res.json({ message: `${provider} reindex started in background.`, provider })
}
