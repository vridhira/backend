/**
 * Subscriber: product.created, product.updated → syncProductsWorkflow
 *
 * Triggered whenever a product is created or updated in Medusa admin.
 * The product's ID is passed as a filter so only that product is re-indexed.
 */
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { syncProductsWorkflow } from "../workflows/sync-products"

export default async function handleProductEvents({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  await syncProductsWorkflow(container).run({
    input: {
      filters: { id: data.id },
    },
  })
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}
