import { defineMiddlewares, authenticate } from "@medusajs/framework/http"
import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import logger from "../lib/logger"
import { getRedisClient } from "../lib/redis-client"

const log = logger.child({ module: "middlewares" })

// ── Cart completion idempotency lock (BUG-003 fix) ────────────────────────────
// Prevents duplicate order creation from double-click or network retries.
// Uses Redis SET NX EX to acquire a per-cart lock. If the lock is held,
// a 409 is returned so the frontend can detect and stop retrying.
// Lock TTL is 30s — enough for any cart completion to finish.
// Falls back gracefully (allow through) if Redis is unavailable.
const CART_COMPLETE_LOCK_TTL_SECS = 30

async function cartCompletionLock(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  // Extract cart ID from /store/carts/:id/complete
  const segments = req.path.split("/")
  const cartIdx = segments.indexOf("carts")
  const cartId = cartIdx !== -1 ? segments[cartIdx + 1] : undefined

  if (!cartId) return next()

  const lockKey = `cart:completing:${cartId}`

  try {
    const redis = getRedisClient()
    const acquired = await redis.call("SET", lockKey, "1", "NX", "EX", String(CART_COMPLETE_LOCK_TTL_SECS)) as string | null

    if (acquired === null) {
      log.warn({ cartId }, "Cart completion already in progress — duplicate request rejected")
      res.status(409).json({ message: "Cart completion already in progress. Please wait and check your orders." })
      return
    }

    // Release lock when response finishes (success or error)
    res.on("finish", () => {
      redis.del(lockKey).catch(() => { /* best-effort cleanup */ })
    })
  } catch (redisErr) {
    // Redis unavailable — allow through (availability > duplicate prevention on outage)
    log.warn({ err: redisErr }, "Cart completion lock unavailable — allowing request through")
  }

  return next()
}
// Rejects requests whose Content-Length header exceeds 1 MB.
// This is a defense-in-depth measure — production should also apply limits
// at the Nginx/ALB layer (client_max_body_size 1m in nginx.conf).
const BODY_LIMIT_BYTES = 1 * 1024 * 1024  // 1 MB global limit
const WEBHOOK_BODY_LIMIT_BYTES = 512 * 1024  // 512 KB for webhook endpoints

function bodySizeGuard(limitBytes: number) {
  return function (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
    const contentLength = parseInt(req.headers["content-length"] ?? "0", 10)
    if (!isNaN(contentLength) && contentLength > limitBytes) {
      log.warn({ ip: req.ip, path: req.path, contentLength }, "Request body too large — rejected")
      res.status(413).json({ message: "Request entity too large." })
      return
    }
    return next()
  }
}
// Protects /auth/customer/emailpass (login) and reset-password from
// credential stuffing and password-reset spam.
// Primary store: Redis. Fallback: in-memory Map (single-process protection).
// Limit: 10 requests per 15 minutes per IP.
const AUTH_RATE_LIMIT_MAX = 10
const AUTH_RATE_LIMIT_WINDOW_SECS = 15 * 60  // 15 minutes
const inMemoryAuthRateLimit = new Map<string, { count: number; resetAt: number }>()

async function authRateLimiter(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  // Use X-Forwarded-For header if behind a proxy; fall back to socket IP
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  const rlKey = `rl:auth:${ip}`

  try {
    const redis = getRedisClient()
    // INCR returns the new count; set TTL on first call (NX)
    const count = await redis.incr(rlKey)
    if (count === 1) {
      await redis.expire(rlKey, AUTH_RATE_LIMIT_WINDOW_SECS)
    }
    if (count > AUTH_RATE_LIMIT_MAX) {
      log.warn({ ip, count }, "Auth rate limit exceeded (Redis)")
      res.status(429).json({
        message: "Too many login attempts. Please try again in 15 minutes.",
      })
      return
    }
  } catch (redisErr) {
    // Redis unavailable — fall back to in-memory counter
    log.warn({ err: redisErr }, "Redis auth rate-limit unavailable — using in-memory fallback")
    const now = Date.now()
    const entry = inMemoryAuthRateLimit.get(ip)
    if (!entry || now > entry.resetAt) {
      inMemoryAuthRateLimit.set(ip, { count: 1, resetAt: now + AUTH_RATE_LIMIT_WINDOW_SECS * 1000 })
    } else {
      entry.count++
      if (entry.count > AUTH_RATE_LIMIT_MAX) {
        log.warn({ ip, count: entry.count }, "Auth rate limit exceeded (in-memory fallback)")
        res.status(429).json({
          message: "Too many login attempts. Please try again in 15 minutes.",
        })
        return
      }
    }
  }

  return next()
}

// ── Verified-purchase middleware ───────────────────────────────────────────────
// Applied to POST /store/product-reviews (the @lambdacurry/medusa-product-reviews
// plugin endpoint). Enforces two rules:
//   1. Customer must be authenticated.
//   2. Customer must have a delivered order that contains the product reviewed.
// Also injects the customer's real account name as display_name so it cannot be
// spoofed from the frontend.
async function requireVerifiedPurchase(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const customer_id = (req as any).auth_context?.actor_id as string | undefined
  if (!customer_id) {
    return res.status(401).json({ message: "You must be logged in to write a review." })
  }

  const body = req.body as Record<string, unknown>
  const product_id = body?.product_id as string | undefined
  if (!product_id) return next()

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

    // Check that customer has a delivered order containing this product
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "fulfillment_status", "items.product_id"],
      filters: { customer_id },
    })

    const hasDelivered = (orders as any[]).some(
      (order) =>
        (order.fulfillment_status === "delivered" ||
          order.fulfillment_status === "partially_delivered") &&
        (order.items as any[])?.some((item) => item.product_id === product_id)
    )

    if (!hasDelivered) {
      return res.status(403).json({
        message: "Only verified buyers with a delivered order can review this product.",
      })
    }

    // BUG-011 FIX: Prevent duplicate reviews — one review per customer per product.
    // Check if this customer already submitted a review (any status: pending/approved/rejected).
    try {
      const { data: existingReviews } = await query.graph({
        entity: "product_review",
        fields: ["id"],
        filters: { customer_id, product_id },
        pagination: { take: 1 },
      })
      if ((existingReviews as any[])?.length > 0) {
        return res.status(409).json({
          message: "You have already submitted a review for this product.",
        })
      }
    } catch (reviewCheckErr) {
      // If the entity name is different in the installed plugin version, skip the check
      // rather than blocking legitimate reviews. Log so it can be investigated.
      log.warn({ err: reviewCheckErr }, "Duplicate review check failed — skipping guard")
    }

    // Inject real customer name — cannot be spoofed from frontend
    const { data: customers } = await query.graph({
      entity: "customer",
      fields: ["first_name", "last_name"],
      filters: { id: customer_id },
    })
    const c = (customers as any[])?.[0]
    const fullName = [c?.first_name, c?.last_name].filter(Boolean).join(" ")
    if (fullName) body.display_name = fullName

    return next()
    } catch (err) {
    log.error({ err }, "ReviewMiddleware error")
    return res.status(500).json({ message: "Failed to verify purchase eligibility." })
  }
}

/**
 * API Route Middlewares
 *
 * Enforces authentication on custom store routes that require a logged-in customer.
 * Per Medusa v2 docs, the authenticate middleware must be explicitly applied to
 * custom routes — it is NOT automatically inherited from built-in route protection.
 *
 * @see https://docs.medusajs.com/learn/fundamentals/api-routes/protected-routes
 */
export default defineMiddlewares({
  routes: [
    // ── Global body size guard (BUG-012 fix) ─────────────────────────────────
    // Rejects oversized requests before business logic runs.
    {
      matcher: "/store/**",
      middlewares: [bodySizeGuard(BODY_LIMIT_BYTES)],
    },
    {
      matcher: "/admin/**",
      middlewares: [bodySizeGuard(BODY_LIMIT_BYTES)],
    },
    {
      matcher: "/hooks/**",
      middlewares: [bodySizeGuard(WEBHOOK_BODY_LIMIT_BYTES)],
    },

    // ── Auth rate limiting (BUG-004 fix) ─────────────────────────────────────
    // Prevents credential stuffing and password-reset spam.
    // 10 requests per 15 minutes per IP on login and reset-password endpoints.
    {
      matcher: "/auth/customer/emailpass",
      middlewares: [authRateLimiter],
    },
    {
      matcher: "/auth/customer/emailpass/reset-password",
      middlewares: [authRateLimiter],
    },
    {
      matcher: "/auth/customer/emailpass/update",
      middlewares: [authRateLimiter],
    },

    // ── Cart completion idempotency lock (BUG-003 fix) ───────────────────────
    // Prevents duplicate orders from double-click or network retries.
    {
      matcher: "/store/carts/*/complete",
      method: ["POST"],
      middlewares: [authenticate("customer", ["session", "bearer"]), cartCompletionLock],
    },

    // ── Serviceability check ─────────────────────────────────────────────────
    // Requires a logged-in customer to prevent anonymous actors from probing
    // courier rate cards and exhausting the Shiprocket API quota.
    {
      matcher: "/store/shipping/serviceability*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },

    // ── COD OTP verification ─────────────────────────────────────────────────
    // Bind OTP verification to an authenticated customer session.
    // The handler also validates by payment_session_id, providing defense-in-depth.
    {
      matcher: "/store/cod/verify-otp*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },

    // ── Order tracking ───────────────────────────────────────────────────────
    // Requires a logged-in customer. The handler also verifies order ownership
    // (customer_id on the order must match auth_context.actor_id).
    {
      matcher: "/store/orders/*/tracking*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },

    // ── Customer invoice download ────────────────────────────────────────────
    // Customer must be logged in. Handler also verifies order ownership.
    // GET /store/orders/:id/invoice  → streams PDF using @rsc-labs/medusa-documents-v2
    {
      matcher: "/store/orders/*/invoice*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },

    // ── Wishlist ─────────────────────────────────────────────────────────────
    // All wishlist operations (list, add, remove) require a logged-in customer.
    // The customer_id is derived from auth_context in each handler — never
    // accepted as a query param — to prevent cross-customer data access.
    {
      matcher: "/store/wishlist*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },

    // ── Product Reviews ───────────────────────────────────────────────────────
    // POST /store/product-reviews (plugin endpoint): authenticate + verify delivery.
    // The requireVerifiedPurchase middleware rejects unauthenticated requests,
    // checks the customer has a delivered order with the product, and injects
    // the customer's real name so it cannot be spoofed from the frontend.
    {
      matcher: "/store/product-reviews",
      method: ["POST"],
      middlewares: [
        authenticate("customer", ["session", "bearer"]),
        requireVerifiedPurchase,
      ],
    },

    // ── Review eligibility + pending review checks ────────────────────────────
    // Auth-required so customer_id is available from auth_context in handlers.
    {
      matcher: "/store/custom/review-eligibility*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/custom/pending-reviews*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
  ],
})
