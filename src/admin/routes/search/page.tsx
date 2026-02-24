import { defineRouteConfig } from "@medusajs/admin-sdk"
import { MagnifyingGlass, Check, ExclamationCircle } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Switch,
  Tabs,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"
import { sdk } from "../../lib/sdk"

// ── Types ──────────────────────────────────────────────────────────────────

type SearchProvider = "algolia" | "meilisearch" | "default"

type AlgoliaFeatures = {
  typoTolerance: boolean
  highlights: boolean
  analytics: boolean
  searchableAttributes: string[]
}

type MeilisearchFeatures = {
  typoTolerance: boolean
  faceting: boolean
  highlighting: boolean
  searchableAttributes: string[]
  filterableAttributes: string[]
  sortableAttributes: string[]
}

type EnvKey = { key: string; set: boolean; description: string }

type EnvStatus = {
  [K in SearchProvider]: { provider: string; envKeys: EnvKey[]; configured: boolean }
}

// ── Provider meta ──────────────────────────────────────────────────────────

const PROVIDERS: {
  id: SearchProvider
  name: string
  description: string
  color: "green" | "blue" | "grey"
}[] = [
  {
    id: "algolia",
    name: "Algolia",
    description:
      "Hosted, enterprise-grade search with typo-tolerance, faceting, analytics, and instant results. Best for high-traffic storefronts.",
    color: "blue",
  },
  {
    id: "meilisearch",
    name: "Meilisearch",
    description:
      "Open-source, self-hosted (or cloud) fast search engine. Great for cost-efficient deployments with full control over your data.",
    color: "green",
  },
  {
    id: "default",
    name: "Default (Medusa)",
    description:
      "Medusa's built-in database-backed search. No external service needed — works out of the box. Use as fallback during migrations.",
    color: "grey",
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function parseAttrs(val: string): string[] {
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SearchPage() {
  // ── Server state
  const [activeProvider, setActiveProvider] = useState<SearchProvider>("default")
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null)
  const [algoliaFeatures, setAlgoliaFeatures] = useState<AlgoliaFeatures>({
    typoTolerance: true,
    highlights: true,
    analytics: false,
    searchableAttributes: ["title", "description", "handle"],
  })
  const [meilisearchFeatures, setMeilisearchFeatures] = useState<MeilisearchFeatures>({
    typoTolerance: true,
    faceting: true,
    highlighting: true,
    searchableAttributes: ["title", "description", "handle"],
    filterableAttributes: ["categories.name", "tags.value", "status"],
    sortableAttributes: ["title"],
  })

  // ── UI state
  const [selectedCard, setSelectedCard] = useState<SearchProvider>("default")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [savingFeatures, setSavingFeatures] = useState(false)

  // Editable text fields for array attrs
  const [algoliaSearchable, setAlgoliaSearchable] = useState(
    algoliaFeatures.searchableAttributes.join(", ")
  )
  const [meiliSearchable, setMeiliSearchable] = useState(
    meilisearchFeatures.searchableAttributes.join(", ")
  )
  const [meiliFilterable, setMeiliFilterable] = useState(
    meilisearchFeatures.filterableAttributes.join(", ")
  )
  const [meiliSortable, setMeiliSortable] = useState(
    meilisearchFeatures.sortableAttributes.join(", ")
  )

  // ── Load initial data
  useEffect(() => {
    Promise.all([
      sdk.client.fetch<{ config: { activeProvider: SearchProvider; algoliaFeatures: AlgoliaFeatures; meilisearchFeatures: MeilisearchFeatures } }>("/admin/search/provider"),
      sdk.client.fetch<EnvStatus>("/admin/search/env-status"),
      sdk.client.fetch<{ features: { algoliaFeatures: AlgoliaFeatures; meilisearchFeatures: MeilisearchFeatures } }>("/admin/search/features"),
    ])
      .then(([providerRes, envRes, featuresRes]) => {
        const prov = (providerRes as any).config?.activeProvider ?? "default"
        setActiveProvider(prov)
        setSelectedCard(prov)
        setEnvStatus(envRes as any)

        const af = (featuresRes as any).features?.algoliaFeatures
        const mf = (featuresRes as any).features?.meilisearchFeatures
        if (af) {
          setAlgoliaFeatures(af)
          setAlgoliaSearchable(af.searchableAttributes?.join(", ") ?? "")
        }
        if (mf) {
          setMeilisearchFeatures(mf)
          setMeiliSearchable(mf.searchableAttributes?.join(", ") ?? "")
          setMeiliFilterable(mf.filterableAttributes?.join(", ") ?? "")
          setMeiliSortable(mf.sortableAttributes?.join(", ") ?? "")
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // ── Handlers
  const handleSaveProvider = async () => {
    setSaving(true)
    try {
      const res: any = await sdk.client.fetch("/admin/search/provider", {
        method: "POST",
        body: { activeProvider: selectedCard },
      })
      setActiveProvider(selectedCard)
      toast.success(`Provider changed to ${selectedCard}`, {
        description: res?.message,
      })
    } catch (err) {
      toast.error("Failed to save provider", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      await sdk.client.fetch("/admin/search/sync", {
        method: "POST",
        body: { provider: activeProvider },
      })
      toast.success("Reindex started", {
        description: `All products are being re-indexed in ${activeProvider}. Check server logs for progress.`,
      })
    } catch (err) {
      toast.error("Sync failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      setSyncing(false)
    }
  }

  const handleSaveFeatures = async () => {
    setSavingFeatures(true)
    try {
      const payload =
        selectedCard === "algolia"
          ? {
              algoliaFeatures: {
                ...algoliaFeatures,
                searchableAttributes: parseAttrs(algoliaSearchable),
              },
            }
          : selectedCard === "meilisearch"
          ? {
              meilisearchFeatures: {
                ...meilisearchFeatures,
                searchableAttributes: parseAttrs(meiliSearchable),
                filterableAttributes: parseAttrs(meiliFilterable),
                sortableAttributes: parseAttrs(meiliSortable),
              },
            }
          : {}

      await sdk.client.fetch("/admin/search/features", {
        method: "POST",
        body: payload,
      })

      if (selectedCard === "algolia") {
        setAlgoliaFeatures((f) => ({
          ...f,
          searchableAttributes: parseAttrs(algoliaSearchable),
        }))
      } else if (selectedCard === "meilisearch") {
        setMeilisearchFeatures((f) => ({
          ...f,
          searchableAttributes: parseAttrs(meiliSearchable),
          filterableAttributes: parseAttrs(meiliFilterable),
          sortableAttributes: parseAttrs(meiliSortable),
        }))
      }

      toast.success("Features saved", {
        description:
          selectedCard === "meilisearch"
            ? "Meilisearch index settings applied."
            : "Feature preferences saved.",
      })
    } catch (err) {
      toast.error("Failed to save features", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      setSavingFeatures(false)
    }
  }

  // ── Render helpers
  const isConfigured = (id: SearchProvider) => {
    if (id === "default") return true
    return (envStatus as any)?.[id]?.configured ?? false
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Text className="text-ui-fg-subtle animate-pulse">Loading search configuration…</Text>
      </div>
    )
  }

  return (
    <Container className="p-0 max-w-4xl">
      {/* Header */}
      <div className="px-8 pt-8 pb-6 border-b border-ui-border-base">
        <div className="flex items-start justify-between">
          <div>
            <Heading level="h1" className="mb-1">
              Search Engine
            </Heading>
            <Text className="text-ui-fg-subtle text-sm">
              Switch between Algolia, Meilisearch, or Medusa's default search.
              Changing the provider triggers an automatic full reindex.
            </Text>
          </div>
          <div className="flex items-center gap-2 ml-4 flex-shrink-0">
            <Badge color={isConfigured(activeProvider) ? "green" : "orange"} size="base">
              {activeProvider === "default"
                ? "Default"
                : isConfigured(activeProvider)
                ? `${activeProvider} — ready`
                : `${activeProvider} — unconfigured`}
            </Badge>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="provider" className="w-full">
        <div className="px-8 border-b border-ui-border-base">
          <Tabs.List>
            <Tabs.Trigger value="provider">Provider</Tabs.Trigger>
            <Tabs.Trigger value="env">Env Keys</Tabs.Trigger>
            <Tabs.Trigger value="features">Features</Tabs.Trigger>
          </Tabs.List>
        </div>

        {/* ── TAB 1: PROVIDER ─────────────────────────────────────────────── */}
        <Tabs.Content value="provider" className="px-8 py-6">
          <Text className="text-ui-fg-subtle text-sm mb-5">
            Select a search provider. Clicking "Set as Active" saves the selection
            and triggers a full reindex in the background.
          </Text>

          <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-3">
            {PROVIDERS.map((p) => {
              const configured = isConfigured(p.id)
              const isActive = activeProvider === p.id
              const isSelected = selectedCard === p.id

              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedCard(p.id)}
                  className={`relative text-left rounded-xl border-2 p-5 transition-all cursor-pointer focus:outline-none ${
                    isSelected
                      ? "border-ui-border-interactive bg-ui-bg-highlight"
                      : "border-ui-border-base bg-ui-bg-subtle hover:border-ui-border-strong hover:bg-ui-bg-base"
                  }`}
                >
                  {/* Active badge */}
                  {isActive && (
                    <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-ui-tag-green-bg">
                      <Check className="text-ui-tag-green-icon" />
                    </span>
                  )}

                  {/* Selected dot */}
                  {isSelected && !isActive && (
                    <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-ui-bg-interactive">
                      <span className="h-2 w-2 rounded-full bg-white" />
                    </span>
                  )}

                  <p className="text-base-semi text-ui-fg-base mb-1">{p.name}</p>
                  <p className="text-xsmall-regular text-ui-fg-subtle mb-3 leading-relaxed">
                    {p.description}
                  </p>

                  <div className="flex items-center gap-1.5">
                    {p.id === "default" ? (
                      <Badge color="grey" size="xsmall">No setup required</Badge>
                    ) : configured ? (
                      <Badge color="green" size="xsmall">Env vars set</Badge>
                    ) : (
                      <Badge color="orange" size="xsmall">Missing env vars</Badge>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSaveProvider}
              isLoading={saving}
              disabled={saving || selectedCard === activeProvider}
              variant="primary"
              size="base"
            >
              {selectedCard === activeProvider
                ? "Active provider"
                : `Set ${PROVIDERS.find((p) => p.id === selectedCard)?.name} as active`}
            </Button>

            {activeProvider !== "default" && (
              <Button
                onClick={handleSync}
                isLoading={syncing}
                disabled={syncing}
                variant="secondary"
                size="base"
              >
                {syncing ? "Reindexing…" : `Sync all products now`}
              </Button>
            )}
          </div>

          {activeProvider !== "default" && !isConfigured(activeProvider) && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-ui-tag-orange-bg border border-ui-tag-orange-border p-3">
              <ExclamationCircle className="text-ui-tag-orange-icon mt-0.5 flex-shrink-0" />
              <Text className="text-ui-tag-orange-text text-small-regular">
                The active provider has missing environment variables. Switch to the{" "}
                <strong>Env Keys</strong> tab to see what's needed.
              </Text>
            </div>
          )}
        </Tabs.Content>

        {/* ── TAB 2: ENV KEYS ─────────────────────────────────────────────── */}
        <Tabs.Content value="env" className="px-8 py-6">
          <Text className="text-ui-fg-subtle text-sm mb-5">
            Environment variables required for{" "}
            <strong>
              {PROVIDERS.find((p) => p.id === selectedCard)?.name ?? selectedCard}
            </strong>
            . Add these to your{" "}
            <code className="text-xsmall-regular bg-ui-bg-subtle px-1 py-0.5 rounded">
              .env
            </code>{" "}
            file and restart the server.
          </Text>

          {selectedCard === "default" ? (
            <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-6 text-center">
              <p className="text-base-semi text-ui-fg-base mb-1">No setup required</p>
              <p className="text-small-regular text-ui-fg-subtle">
                Medusa's default search uses the existing database — no external service
                or environment variables needed.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-ui-border-base overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-ui-bg-subtle border-b border-ui-border-base">
                    <th className="px-4 py-3 text-left text-xsmall-semi text-ui-fg-subtle uppercase tracking-wider w-56">
                      Variable
                    </th>
                    <th className="px-4 py-3 text-left text-xsmall-semi text-ui-fg-subtle uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-4 py-3 text-right text-xsmall-semi text-ui-fg-subtle uppercase tracking-wider w-28">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ui-border-base">
                  {((envStatus as any)?.[selectedCard]?.envKeys ?? []).map(
                    (envKey: EnvKey) => (
                      <tr key={envKey.key} className="bg-ui-bg-base">
                        <td className="px-4 py-3">
                          <code className="text-xsmall-regular font-mono bg-ui-bg-subtle px-2 py-0.5 rounded text-ui-fg-base">
                            {envKey.key}
                          </code>
                        </td>
                        <td className="px-4 py-3 text-small-regular text-ui-fg-subtle">
                          {envKey.description}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {envKey.set ? (
                            <Badge color="green" size="xsmall">Set</Badge>
                          ) : (
                            <Badge color="red" size="xsmall">Missing</Badge>
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 rounded-lg bg-ui-bg-subtle border border-ui-border-base p-4">
            <p className="text-xsmall-semi text-ui-fg-base mb-2">Quick copy — .env snippet</p>
            <pre className="text-xsmall-regular font-mono text-ui-fg-subtle whitespace-pre leading-relaxed">
              {selectedCard === "algolia"
                ? `ALGOLIA_APP_ID=your-app-id\nALGOLIA_API_KEY=your-admin-api-key\nALGOLIA_PRODUCT_INDEX_NAME=products`
                : selectedCard === "meilisearch"
                ? `MEILISEARCH_HOST=http://localhost:7700\nMEILISEARCH_API_KEY=your-master-key\nMEILISEARCH_PRODUCT_INDEX_NAME=products`
                : "# No env vars required"}
            </pre>
          </div>
        </Tabs.Content>

        {/* ── TAB 3: FEATURES ─────────────────────────────────────────────── */}
        <Tabs.Content value="features" className="px-8 py-6">
          <Text className="text-ui-fg-subtle text-sm mb-5">
            Configure search features for{" "}
            <strong>
              {PROVIDERS.find((p) => p.id === selectedCard)?.name ?? selectedCard}
            </strong>
            .
            {selectedCard === "meilisearch" && (
              <> Settings are applied live to the Meilisearch index when saved.</>
            )}
          </Text>

          {selectedCard === "default" && (
            <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-6 text-center">
              <p className="text-base-semi text-ui-fg-base mb-1">No configurable features</p>
              <p className="text-small-regular text-ui-fg-subtle">
                The default provider uses Medusa's built-in search — no feature
                configuration is needed.
              </p>
            </div>
          )}

          {selectedCard === "algolia" && (
            <div className="space-y-4">
              {(
                [
                  { key: "typoTolerance", label: "Typo Tolerance", description: "Allow minor typos in search queries to still return relevant results." },
                  { key: "highlights", label: "Result Highlighting", description: "Highlight matching words in search results returned to the storefront." },
                  { key: "analytics", label: "Analytics", description: "Enable Algolia analytics to track popular queries and click-through rates." },
                ] as { key: keyof AlgoliaFeatures; label: string; description: string }[]
              ).map(({ key, label, description }) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4"
                >
                  <div className="flex-1 pr-4">
                    <p className="text-small-semi text-ui-fg-base">{label}</p>
                    <p className="text-xsmall-regular text-ui-fg-subtle mt-0.5">{description}</p>
                  </div>
                  <Switch
                    checked={!!algoliaFeatures[key as keyof AlgoliaFeatures]}
                    onCheckedChange={(checked) =>
                      setAlgoliaFeatures((f) => ({ ...f, [key]: checked }))
                    }
                  />
                </div>
              ))}

              <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
                <label className="text-small-semi text-ui-fg-base block mb-1">
                  Searchable Attributes
                </label>
                <p className="text-xsmall-regular text-ui-fg-subtle mb-2">
                  Comma-separated list of product fields to index for searching.
                </p>
                <input
                  type="text"
                  value={algoliaSearchable}
                  onChange={(e) => setAlgoliaSearchable(e.target.value)}
                  className="w-full border border-ui-border-base rounded-md px-3 py-2 text-small-regular bg-ui-bg-field text-ui-fg-base focus:outline-none focus:ring-1 focus:ring-ui-border-interactive"
                  placeholder="title, description, handle"
                />
              </div>
            </div>
          )}

          {selectedCard === "meilisearch" && (
            <div className="space-y-4">
              {(
                [
                  { key: "typoTolerance", label: "Typo Tolerance", description: "Allow minor typos in search queries." },
                  { key: "faceting", label: "Faceting", description: "Enable faceted search for filtering by categories, tags, etc." },
                  { key: "highlighting", label: "Highlighting", description: "Highlight matching words in returned search results." },
                ] as { key: keyof MeilisearchFeatures; label: string; description: string }[]
              ).map(({ key, label, description }) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4"
                >
                  <div className="flex-1 pr-4">
                    <p className="text-small-semi text-ui-fg-base">{label}</p>
                    <p className="text-xsmall-regular text-ui-fg-subtle mt-0.5">{description}</p>
                  </div>
                  <Switch
                    checked={!!meilisearchFeatures[key as keyof MeilisearchFeatures]}
                    onCheckedChange={(checked) =>
                      setMeilisearchFeatures((f) => ({ ...f, [key]: checked }))
                    }
                  />
                </div>
              ))}

              {[
                {
                  label: "Searchable Attributes",
                  description: "Fields Meilisearch will search in. Order matters — first field has highest priority.",
                  value: meiliSearchable,
                  onChange: setMeiliSearchable,
                  placeholder: "title, description, handle",
                },
                {
                  label: "Filterable Attributes",
                  description: "Fields customers can filter by (e.g. in faceted search). Applied to the index settings.",
                  value: meiliFilterable,
                  onChange: setMeiliFilterable,
                  placeholder: "categories.name, tags.value, status",
                },
                {
                  label: "Sortable Attributes",
                  description: "Fields customers can sort search results by.",
                  value: meiliSortable,
                  onChange: setMeiliSortable,
                  placeholder: "title",
                },
              ].map(({ label, description, value, onChange, placeholder }) => (
                <div
                  key={label}
                  className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4"
                >
                  <label className="text-small-semi text-ui-fg-base block mb-1">{label}</label>
                  <p className="text-xsmall-regular text-ui-fg-subtle mb-2">{description}</p>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full border border-ui-border-base rounded-md px-3 py-2 text-small-regular bg-ui-bg-field text-ui-fg-base focus:outline-none focus:ring-1 focus:ring-ui-border-interactive"
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
          )}

          {selectedCard !== "default" && (
            <div className="mt-6">
              <Button
                onClick={handleSaveFeatures}
                isLoading={savingFeatures}
                disabled={savingFeatures}
                variant="primary"
                size="base"
              >
                {savingFeatures ? "Saving…" : "Save Features"}
              </Button>
            </div>
          )}
        </Tabs.Content>
      </Tabs>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Search Engine",
  icon: MagnifyingGlass,
})
