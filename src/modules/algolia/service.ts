import { algoliasearch, SearchClient } from "algoliasearch"

type AlgoliaOptions = {
  apiKey: string
  appId: string
  productIndexName: string
}

export type AlgoliaIndexType = "product"

export default class AlgoliaModuleService {
  private client: SearchClient
  private options: AlgoliaOptions

  constructor({}, options: AlgoliaOptions) {
    this.client = algoliasearch(options.appId, options.apiKey)
    this.options = options
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
    await this.client.saveObjects({
      indexName,
      objects: data.map((item) => ({
        ...item,
        // objectID lets Algolia overwrite the record on re-indexing
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
    const results = await this.client.getObjects({
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
    await this.client.deleteObjects({ indexName, objectIDs: ids })
  }

  // ── Storefront search ─────────────────────────────────────────────────────
  async searchProducts(query: string): Promise<Record<string, unknown>[]> {
    const indexName = await this.getIndexName("product")
    const { hits } = await this.client.searchSingleIndex({
      indexName,
      searchParams: { query },
    })
    return hits as Record<string, unknown>[]
  }
}
