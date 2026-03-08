import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { addToWishlistWorkflow } from "../../../workflows/wishlist"
import { WISHLIST_MODULE } from "../../../modules/wishlist"
import WishlistModuleService from "../../../modules/wishlist/service"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// GET /store/wishlist
// Returns the authenticated customer's wishlist items with full product data.
// customer_id is always taken from auth_context — never from query params.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customer_id = (req as any).auth_context?.actor_id as string

  if (!customer_id) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const wishlistService: WishlistModuleService = req.scope.resolve(WISHLIST_MODULE)
  const items = await wishlistService.listWishlistItems({ customer_id })

  if (!items.length) {
    return res.json({ wishlist: [] })
  }

  // Fetch full product data for all wishlist items in one query
  const productIds = [...new Set(items.map((i) => i.product_id))]
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  let productMap: Record<string, any> = {}
  try {
    const { data: products } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "handle",
        "description",
        "thumbnail",
        "images.id",
        "images.url",
        "variants.id",
        "variants.title",
        "variants.prices.amount",
        "variants.prices.currency_code",
      ],
      filters: { id: productIds },
    })
    for (const p of products as any[]) {
      productMap[p.id] = p
    }
  } catch {
    // If product fetch fails, return items without product data rather than erroring
  }

  const wishlist = items.map((item) => ({
    ...item,
    product: productMap[item.product_id] ?? null,
  }))

  res.json({ wishlist })
}

// POST /store/wishlist  { product_id, variant_id? }
// customer_id is taken from auth_context — not accepted from the request body.
// Returns the existing item if the product is already in the wishlist (idempotent).
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customer_id = (req as any).auth_context?.actor_id as string

  if (!customer_id) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const { product_id, variant_id, metadata } = req.body as {
    product_id: string
    variant_id?: string
    metadata?: Record<string, unknown>
  }

  // Basic input validation — product_id must be a non-empty string of reasonable length.
  if (!product_id || typeof product_id !== "string" || product_id.trim().length === 0 || product_id.length > 255) {
    return res.status(400).json({ error: "product_id must be a non-empty string (max 255 chars)." })
  }

  const wishlistService: WishlistModuleService = req.scope.resolve(WISHLIST_MODULE)

  // Duplicate guard — return existing item if product already wishlisted
  const [existing] = await wishlistService.listWishlistItems({ customer_id, product_id })
  if (existing) {
    return res.status(200).json({ wishlist_item: existing, already_exists: true })
  }

  const { result } = await addToWishlistWorkflow(req.scope).run({
    input: { customer_id, product_id, variant_id, metadata },
  })

  res.status(201).json({ wishlist_item: result })
}
