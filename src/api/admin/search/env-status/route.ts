/**
 * GET /admin/search/env-status
 *
 * Returns which environment variables are set (value presence only — never
 * leaks the actual secret value to the admin UI).
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

type EnvKey = {
  key: string
  set: boolean
  description: string
}

type ProviderEnvStatus = {
  provider: string
  envKeys: EnvKey[]
  configured: boolean
}

function checkEnv(key: string, description: string): EnvKey {
  return { key, set: !!process.env[key], description }
}

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const algolia: ProviderEnvStatus = (() => {
    const keys = [
      checkEnv("ALGOLIA_APP_ID", "Algolia Application ID (from dashboard.algolia.com)"),
      checkEnv("ALGOLIA_API_KEY", "Algolia Admin API Key (write access, backend only)"),
      checkEnv("ALGOLIA_PRODUCT_INDEX_NAME", "Name of the Algolia products index, e.g. \"products\""),
    ]
    return { provider: "algolia", envKeys: keys, configured: keys.every((k) => k.set) }
  })()

  const meilisearch: ProviderEnvStatus = (() => {
    const keys = [
      checkEnv("MEILISEARCH_HOST", "Meilisearch host URL, e.g. http://localhost:7700"),
      checkEnv("MEILISEARCH_API_KEY", "Meilisearch Admin/Master API key"),
      checkEnv("MEILISEARCH_PRODUCT_INDEX_NAME", "Name of the Meilisearch products index, e.g. \"products\""),
    ]
    return { provider: "meilisearch", envKeys: keys, configured: keys.every((k) => k.set) }
  })()

  const defaultProvider: ProviderEnvStatus = {
    provider: "default",
    envKeys: [],
    configured: true,
  }

  return res.json({ algolia, meilisearch, default: defaultProvider })
}
