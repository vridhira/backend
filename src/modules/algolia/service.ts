import { algoliasearch, SearchClient } from "algoliasearch"
import { MedusaError } from "@medusajs/framework/utils"

type AlgoliaOptions = {
  apiKey: string
  appId: string
  productIndexName: string
}

export type AlgoliaIndexType = "product"

export default class AlgoliaModuleService {
  private client: SearchClient | null = null
  private options: AlgoliaOptions

  constructor({}: Record<string, unknown>, options: AlgoliaOptions) {
    this.options = options

    if (!options.appId || !options.apiKey || !options.productIndexName) {
      // Don't crash on startup — module may not be the active provider
      console.warn(
        "[AlgoliaModule] Missing appId/apiKey/productIndexName — module loaded but inactive until env vars are set."
      )
      return
    }

    this.client = algoliasearch(options.appId, options.apiKey)
  }

  private getClient(): SearchClient {
    if (!this.client) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "Algolia client is not initialized. Set ALGOLIA_APP_ID, ALGOLIA_API_KEY, and ALGOLIA_PRODUCT_INDEX_NAME env vars."
      )
    }
    return this.client
  }

  // ── Index name resolution ──────────────────────────────────────────────────
  async getIndexName(type: AlgoliaIndexType): Promise<string> {
    switch (type) {
      case "product":
        return this.options.productIndexName
      default:
        throw new Error(`Invalid Algolia index type: ${type}`)
    }
  }

  // ── Create / update records ────────────────────────────────────────────────
  async indexData(
    data: Record<string, unknown>[],
    type: AlgoliaIndexType = "product"
  ): Promise<void> {
    const indexName = await this.getIndexName(type)
    await this.getClient().saveObjects({
      indexName,
      objects: data.map((item) => ({
        ...item,
        objectID: item.id as string,
      })),
    })
  }

  // ── Retrieve existing records by ID ───────────────────────────────────────
  async retrieveFromIndex(
    ids: string[],
    type: AlgoliaIndexType = "product"
  ): Promise<{ results: Array<Record<string, unknown> & { objectID: string }> }> {
    if (!ids.length) return { results: [] }

    const indexName = await this.getIndexName(type)
    const results = await this.getClient().getObjects({
      requests: ids.map((objectID) => ({ indexName, objectID })),
    })

    return { results: (results.results ?? []) as any }
  }

  // ── Delete records by ID ──────────────────────────────────────────────────
  async deleteFromIndex(
    ids: string[],
    type: AlgoliaIndexType = "product"
  ): Promise<void> {
    if (!ids.length) return

    const indexName = await this.getIndexName(type)
    await this.getClient().deleteObjects({ indexName, objectIDs: ids })
  }

  // ── Storefront search ─────────────────────────────────────────────────────
  async searchProducts(query: string): Promise<Record<string, unknown>[]> {
    const indexName = await this.getIndexName("product")
    const { hits } = await this.getClient().searchSingleIndex({
      indexName,
      searchParams: { query },
    })
    return hits as Record<string, unknown>[]
  }
}
