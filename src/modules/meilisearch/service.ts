import { MedusaError } from "@medusajs/framework/utils"
import { Meilisearch } from "meilisearch"

export type MeilisearchIndexType = "product"

type MeilisearchOptions = {
  host: string
  apiKey: string
  productIndexName: string
}

export type MeilisearchFeaturesConfig = {
  typoTolerance: boolean
  faceting: boolean
  highlighting: boolean
  searchableAttributes: string[]
  filterableAttributes: string[]
  sortableAttributes: string[]
}

export const DEFAULT_MEILI_FEATURES: MeilisearchFeaturesConfig = {
  typoTolerance: true,
  faceting: true,
  highlighting: true,
  searchableAttributes: ["title", "description", "handle"],
  filterableAttributes: ["categories.name", "tags.value", "status"],
  sortableAttributes: ["title"],
}

export default class MeilisearchModuleService {
  private client: InstanceType<typeof Meilisearch> | null = null
  private options: MeilisearchOptions

  constructor({}: Record<string, unknown>, options: MeilisearchOptions) {
    this.options = options

    if (!options.host || !options.apiKey || !options.productIndexName) {
      // Don't crash on startup — module may not be the active provider
      console.warn(
        "[MeilisearchModule] Missing host/apiKey/productIndexName — module loaded but inactive until env vars are set."
      )
      return
    }

    this.client = new Meilisearch({
      host: options.host,
      apiKey: options.apiKey,
    })
  }

  private getClient(): InstanceType<typeof Meilisearch> {
    if (!this.client) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "Meilisearch client is not initialized. Set MEILISEARCH_HOST, MEILISEARCH_API_KEY, and MEILISEARCH_PRODUCT_INDEX_NAME env vars."
      )
    }
    return this.client
  }

  // ── Index name ─────────────────────────────────────────────────────────────
  async getIndexName(type: MeilisearchIndexType): Promise<string> {
    switch (type) {
      case "product":
        return this.options.productIndexName
      default:
        throw new Error(`Invalid Meilisearch index type: ${type}`)
    }
  }

  // ── Create / update documents ──────────────────────────────────────────────
  async indexData(
    data: Record<string, unknown>[],
    type: MeilisearchIndexType = "product"
  ): Promise<void> {
    if (!data.length) return

    const client = this.getClient()
    const indexName = await this.getIndexName(type)
    const index = client.index(indexName)

    const documents = data.map((item) => ({ ...item, id: item.id as string }))
    await index.addDocuments(documents, { primaryKey: "id" })
  }

  // ── Retrieve existing documents by ID ─────────────────────────────────────
  async retrieveFromIndex(
    ids: string[],
    type: MeilisearchIndexType = "product"
  ): Promise<{ results: Array<Record<string, unknown>> }> {
    if (!ids.length) return { results: [] }

    const client = this.getClient()
    const indexName = await this.getIndexName(type)
    const index = client.index(indexName)

    try {
      const results: Record<string, unknown>[] = []
      for (const id of ids) {
        try {
          const doc = await index.getDocument(id)
          results.push(doc as Record<string, unknown>)
        } catch {
          // Document doesn't exist yet — skip
        }
      }
      return { results }
    } catch {
      return { results: [] }
    }
  }

  // ── Delete documents by ID ─────────────────────────────────────────────────
  async deleteFromIndex(
    ids: string[],
    type: MeilisearchIndexType = "product"
  ): Promise<void> {
    if (!ids.length) return

    const client = this.getClient()
    const indexName = await this.getIndexName(type)
    const index = client.index(indexName)

    await index.deleteDocuments(ids)
  }

  // ── Apply index settings (searchable / filterable / sortable) ──────────────
  async applySettings(features: Partial<MeilisearchFeaturesConfig>): Promise<void> {
    const client = this.getClient()
    const indexName = await this.getIndexName("product")
    const index = client.index(indexName)

    const settings: Record<string, unknown> = {}

    if (features.searchableAttributes)
      settings.searchableAttributes = features.searchableAttributes

    if (features.filterableAttributes)
      settings.filterableAttributes = features.filterableAttributes

    if (features.sortableAttributes)
      settings.sortableAttributes = features.sortableAttributes

    if (typeof features.typoTolerance !== "undefined")
      settings.typoTolerance = { enabled: features.typoTolerance }

    if (Object.keys(settings).length) {
      await index.updateSettings(settings as any)
    }
  }

  // ── Storefront search ──────────────────────────────────────────────────────
  async searchProducts(query: string): Promise<Record<string, unknown>[]> {
    const client = this.getClient()
    const indexName = await this.getIndexName("product")
    const index = client.index(indexName)

    const { hits } = await index.search(query)
    return hits as Record<string, unknown>[]
  }
}
