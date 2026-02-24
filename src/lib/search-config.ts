/**
 * src/lib/search-config.ts
 *
 * Shared utility for reading and writing the active search provider config.
 * Config is stored in `.search-config.json` at the backend project root.
 * This file is safe to commit (just stores preferences, not secrets).
 */

import fs from "fs"
import path from "path"

export type SearchProvider = "algolia" | "meilisearch" | "default"

export type AlgoliaFeatures = {
  typoTolerance: boolean
  highlights: boolean
  analytics: boolean
  searchableAttributes: string[]
}

export type MeilisearchFeatures = {
  typoTolerance: boolean
  faceting: boolean
  highlighting: boolean
  searchableAttributes: string[]
  filterableAttributes: string[]
  sortableAttributes: string[]
}

export type SearchConfig = {
  activeProvider: SearchProvider
  algoliaFeatures: AlgoliaFeatures
  meilisearchFeatures: MeilisearchFeatures
}

const CONFIG_PATH = path.resolve(process.cwd(), ".search-config.json")

const DEFAULT_CONFIG: SearchConfig = {
  activeProvider: "default",
  algoliaFeatures: {
    typoTolerance: true,
    highlights: true,
    analytics: false,
    searchableAttributes: ["title", "description", "handle"],
  },
  meilisearchFeatures: {
    typoTolerance: true,
    faceting: true,
    highlighting: true,
    searchableAttributes: ["title", "description", "handle"],
    filterableAttributes: ["categories.name", "tags.value", "status"],
    sortableAttributes: ["title"],
  },
}

export function readSearchConfig(): SearchConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8")
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    }
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_CONFIG }
}

export function writeSearchConfig(config: Partial<SearchConfig>): SearchConfig {
  const current = readSearchConfig()
  const updated: SearchConfig = {
    ...current,
    ...config,
    algoliaFeatures: { ...current.algoliaFeatures, ...config.algoliaFeatures },
    meilisearchFeatures: {
      ...current.meilisearchFeatures,
      ...config.meilisearchFeatures,
    },
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), "utf-8")
  return updated
}

export function getActiveProvider(): SearchProvider {
  return readSearchConfig().activeProvider
}
