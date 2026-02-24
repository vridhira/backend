/**
 * GET  /admin/search/features  → { features: { algoliaFeatures, meilisearchFeatures } }
 * POST /admin/search/features  → { features: SearchConfig }
 *   body: { algoliaFeatures?: Partial<AlgoliaFeatures>, meilisearchFeatures?: Partial<MeilisearchFeatures> }
 *
 * When Meilisearch features are saved, the index settings are applied live.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { readSearchConfig, writeSearchConfig } from "../../../../lib/search-config"
import { MEILISEARCH_MODULE } from "../../../../modules/meilisearch"
import MeilisearchModuleService from "../../../../modules/meilisearch/service"

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const { algoliaFeatures, meilisearchFeatures } = readSearchConfig()
  return res.json({ features: { algoliaFeatures, meilisearchFeatures } })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { algoliaFeatures, meilisearchFeatures } = req.body as any

  const updated = writeSearchConfig({ algoliaFeatures, meilisearchFeatures })

  // Apply Meilisearch settings live if Meilisearch module is available
  if (meilisearchFeatures) {
    try {
      const meiliService: MeilisearchModuleService = req.scope.resolve(MEILISEARCH_MODULE)
      await meiliService.applySettings(updated.meilisearchFeatures)
    } catch (err) {
      console.warn("[search/features] Could not apply Meilisearch settings:", (err as Error).message)
    }
  }

  return res.json({ features: { algoliaFeatures: updated.algoliaFeatures, meilisearchFeatures: updated.meilisearchFeatures } })
}
