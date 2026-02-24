import { defineRouteConfig } from "@medusajs/admin-sdk"
import { MagnifyingGlass } from "@medusajs/icons"
import { Button, Container, Heading, Text, Badge, toast } from "@medusajs/ui"
import { useState } from "react"
import { sdk } from "../../lib/sdk"

export default function AlgoliaPage() {
  const [syncing, setSyncing] = useState(false)

  const handleSync = async () => {
    setSyncing(true)
    try {
      await sdk.client.fetch("/admin/algolia/sync", { method: "POST" })
      toast.success("Algolia sync started", {
        description:
          "All products are being indexed in the background. Check server logs for progress.",
      })
    } catch (err) {
      toast.error("Sync failed", {
        description:
          err instanceof Error ? err.message : "Unknown error occurred.",
      })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Container className="p-8 max-w-2xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <Heading level="h1" className="mb-2">
            Algolia Search
          </Heading>
          <Text className="text-ui-fg-subtle">
            Manage your Algolia product search index. Products are automatically
            indexed when created, updated, or deleted. Use the button below to
            trigger a full reindex of all published products.
          </Text>
        </div>
        <Badge color="green" size="base" className="ml-4 flex-shrink-0">
          Connected
        </Badge>
      </div>

      <div className="border border-ui-border-base rounded-lg p-6 bg-ui-bg-subtle mb-6">
        <Heading level="h2" className="text-base mb-1">
          Full Reindex
        </Heading>
        <Text className="text-ui-fg-subtle text-sm mb-4">
          Syncs all published products to Algolia. Unpublished products are
          removed from the index. This runs in the background — no downtime.
        </Text>
        <Button
          onClick={handleSync}
          isLoading={syncing}
          disabled={syncing}
          variant="primary"
          size="base"
        >
          {syncing ? "Indexing…" : "Sync All Products"}
        </Button>
      </div>

      <div className="border border-ui-border-base rounded-lg p-6 bg-ui-bg-subtle">
        <Heading level="h2" className="text-base mb-1">
          Automatic Sync
        </Heading>
        <Text className="text-ui-fg-subtle text-sm">
          The following events automatically update the Algolia index:
        </Text>
        <ul className="mt-3 space-y-2 text-sm text-ui-fg-base list-disc list-inside">
          <li>
            <span className="font-medium">product.created</span> — new product indexed immediately
          </li>
          <li>
            <span className="font-medium">product.updated</span> — product record updated in Algolia
          </li>
          <li>
            <span className="font-medium">product.deleted</span> — product removed from Algolia
          </li>
        </ul>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Algolia Search",
  icon: MagnifyingGlass,
})
