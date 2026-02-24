/**
 * GET  /admin/search/provider  → { config: SearchConfig }
 * POST /admin/search/provider  → { config: SearchConfig }
 *   body: { activeProvider: "algolia"|"meilisearch"|"default" }
 *
 * Saving the provider also emits the appropriate reindex event so the new
 * provider is populated immediately.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { readSearchConfig, writeSearchConfig, SearchProvider } from "../../../../lib/search-config"

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  return res.json({ config: readSearchConfig() })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { activeProvider } = req.body as { activeProvider?: SearchProvider }

  if (!activeProvider || !["algolia", "meilisearch", "default"].includes(activeProvider)) {
    return res.status(400).json({ message: "Invalid activeProvider. Must be algolia | meilisearch | default." })
  }

  const config = writeSearchConfig({ activeProvider })

  // Trigger reindex on the newly-activated provider
  if (activeProvider !== "default") {
    const eventBus = req.scope.resolve(Modules.EVENT_BUS) as any
    await eventBus.emit({
      name: `${activeProvider}.sync`,
      data: {},
    })
  }

  return res.json({ config, message: `Provider switched to "${activeProvider}"${activeProvider !== "default" ? " — reindex started in background" : ""}.` })
}
