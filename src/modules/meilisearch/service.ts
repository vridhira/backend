import { MedusaError } from "@medusajs/framework/utils"

export type MeilisearchIndexType = "product"

type MeilisearchOptions = {
  host: string
  apiKey: string
  productIndexName: string
}

// Locally typed to avoid a static ESM import in a CJS module.
// meilisearch >=0.38 ships as ESM-only; use dynamic import() instead.
type MeiliIndex = {
  addDocuments(
    docs: Record<string, unknown>[],
    opts?: { primaryKey: string }
  ): Promise<unknown>
  getDocument(id: string): Promise<Record<string, unknown>>
  deleteDocuments(ids: string[]): Promise<unknown>
  search(query: string): Promise<{ hits: Record<string, unknown>[] }>
  updateSettings(settings: Record<string, unknown>): Promise<unknown>
}
type MeiliClient = {
  index(name: string): MeiliIndex
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
  // Promise-based to support ESM-only dynamic import() inside CJS
  private clientPromise: Promise<MeiliClient> | null = null
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

    // Pre-warm: kick off the ESM dynamic import immediately
    this.clientPromise = this.createClient()
  }

  private async createClient(): Promise<MeiliClient> {
    // Dynamic import avoids the CJS/ESM conflict (meilisearch >=0.38 is ESM-only)
    const { Meilisearch } = await import("meilisearch")
    return new Meilisearch({
      host: this.options.host,
      apiKey: this.options.apiKey,
    }) as unknown as MeiliClient
  }

  private async getClient(): Promise<MeiliClient> {
    if (!this.clientPromise) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "Meilisearch client is not initialized. Set MEILISEARCH_HOST, MEILISEARCH_API_KEY, and MEILISEARCH_PRODUCT_INDEX_NAME env vars."
      )
    }
    return this.clientPromise
  }

  // ── Index name ─────────────────────────────────────────────────────────────
  getIndexName(type: MeilisearchIndexType): string {
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

    const client = await this.getClient()
    const indexName = this.getIndexName(type)
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

    const client = await this.getClient()
    const indexName = this.getIndexName(type)
    const index = client.index(indexName)

    try {
      const results: Record<string, unknown>[] = []
      for (const id of ids) {
        try {
          const doc = await index.getDocument(id)
          results.push(doc)
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

    const client = await this.getClient()
    const indexName = this.getIndexName(type)
    const index = client.index(indexName)

    await index.deleteDocuments(ids)
  }

  // ── Apply index settings (searchable / filterable / sortable) ──────────────
  async applySettings(features: Partial<MeilisearchFeaturesConfig>): Promise<void> {
    const client = await this.getClient()
    const indexName = this.getIndexName("product")
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
      await index.updateSettings(settings)
    }
  }

  // ── Storefront search ──────────────────────────────────────────────────────
  async searchProducts(query: string): Promise<Record<string, unknown>[]> {
    const client = await this.getClient()
    const indexName = this.getIndexName("product")
    const index = client.index(indexName)

    const { hits } = await index.search(query)
    return hits
  }
}

