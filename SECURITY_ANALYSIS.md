# Vridhira Backend — Security & Architecture Analysis
> Full audit covering flaws, logical gaps, known vulnerabilities, and potential breakdown points  
> Generated: February 25, 2026 | Stack: MedusaJS v2 · PostgreSQL · Redis · Razorpay · Shiprocket · MSG91

---

## Severity Legend
| Level | Symbol | Meaning |
|---|---|---|
| Critical | 🔴 | Exploitable right now, causes data loss or fraud |
| High | 🟠 | Serious gap, exploitable under conditions |
| Medium | 🟡 | Potential issue, requires specific circumstances |
| Low | 🟢 | Best-practice violation or minor risk |
| Info | 🔵 | Design note, not a vulnerability |

---

## PART 1 — Security Vulnerabilities

---

### 🔴 VULN-01 — Meilisearch Master Key Used for Indexing

**File:** `medusa-config.ts`, `.env`  
**Variable:** `MEILISEARCH_API_KEY` — documented as "Master key"

Using the master key for product sync means that if this key leaks (log file, git commit, env exposure), an attacker can:
- Delete all indexes permanently
- Create admin API keys with any permissions
- Wipe the entire Meilisearch instance

**Fix:** Create a dedicated Meilisearch API key with only `indexes.add`, `documents.add`, `documents.delete` permissions scoped to the product index. Never use the master key in application code.

```bash
# Generate a restricted key
curl -X POST 'http://<MEILISEARCH_HOST>/keys' \
  -H 'Authorization: Bearer <MASTER_KEY>' \
  -H 'Content-Type: application/json' \
  --data-binary '{
    "description": "Vridhira product sync key",
    "actions": ["documents.add", "documents.delete", "indexes.create"],
    "indexes": ["products"],
    "expiresAt": null
  }'
```

---

### 🔴 VULN-02 — Shiprocket Token in Query String (Logged by Every Proxy)

**File:** `src/api/hooks/shiprocket/route.ts`  
**Endpoint:** `POST /hooks/shiprocket?token=<SHIPROCKET_WEBHOOK_TOKEN>`

Query string parameters are logged by:
- Nginx / Apache access logs
- AWS ALB / CloudFront access logs
- Sentry breadcrumbs
- Any CDN or WAF in front of the backend

Once `SHIPROCKET_WEBHOOK_TOKEN` appears in a log, anyone with log read access can forge delivery events — marking orders as "delivered", triggering COD capture of cash, sending fake delivery emails.

**Fix:** Move the token to a custom header (`X-Shiprocket-Token`). This requires contacting Shiprocket support or using their webhook signature if they support it.

```typescript
// Temporary mitigation — add to Nginx config:
// access_log off;  — only for the webhook path
// Or: strip the token from logs with log_format
```

---

### 🔴 VULN-03 — Race Condition on Cart Completion (Potential Double-Order)

**Flow:** `POST /store/carts/:id/complete`

There is no explicit idempotency key or distributed lock on cart completion. If the frontend (or a network retry) calls this endpoint twice in rapid succession before the first request commits, Medusa could fire `order.placed` twice, creating two orders, two Shiprocket fulfillments, and two payment captures.

**Attack surface:** Slow network + user double-click or frontend retry logic on timeout.

**Fix:** Add a database-level unique constraint or Redis distributed lock on `cart_id` during completion:

```typescript
// In cart complete middleware
const lockKey = `cart:completing:${cartId}`;
const acquired = await redis.set(lockKey, '1', 'NX', 'EX', 30);
if (!acquired) {
  return res.status(409).json({ message: 'Cart completion already in progress' });
}
try {
  // ... complete cart
} finally {
  await redis.del(lockKey);
}
```

---

### 🔴 VULN-04 — Google OAuth Missing State Parameter (CSRF on Login)

**File:** OAuth callback handler  
**Flow:** `GET /auth/customer/google` → `GET /auth/customer/google/callback?code=...`

The system flow documents redirect to `GOOGLE_CALLBACK_URL` after exchange but there is no mention of:
- A CSRF `state` parameter being generated and validated
- PKCE (Proof Key for Code Exchange)

Without `state`, an attacker can craft a malicious `callback?code=<attacker-controlled-code>` URL and trick a logged-in admin into triggering it (CSRF OAuth attack), potentially linking the admin's session to an attacker-controlled Google account.

**Fix:** Ensure the Medusa Google OAuth plugin generates and validates `state` on every authorization request. Verify this in the plugin source — if it does not, wrap with a custom middleware.

---

### 🔴 VULN-05 — No Rate Limiting on Authentication Endpoints

**Endpoints:**
- `POST /auth/customer/emailpass` (login)
- `POST /auth/customer/emailpass/reset-password` (reset request)

There is Redis rate limiting for COD OTP (well-implemented) but **no equivalent on login or password reset** endpoints. This allows:
- **Credential stuffing** attacks on login
- **Password reset spam** — flooding any email address with reset emails (user harassment + Resend quota exhaustion)

**Fix:**

```typescript
// src/api/middlewares.ts — add before auth routes
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  store: new RedisStore({ client: redisClient }),
  keyGenerator: (req) => req.ip,
  message: { message: 'Too many login attempts, try again in 15 minutes' },
});
```

---

### 🟠 VULN-06 — COD OTP Fail-Open on Redis Outage (SMS Bombing Vector)

**File:** `src/modules/cod-payment/`  
**Documented behaviour:** "Redis down → log warning, continue (Redis outage ≠ blocked checkout)"

If Redis goes down, the 60-second OTP rate limit is completely bypassed. An attacker can then:
1. Initiate COD session → get OTP SMS
2. Immediately initiate another session → get another OTP SMS
3. Repeat indefinitely using the same or different phone numbers

This exhausts MSG91 SMS quota and constitutes SMS bombing of the victim's phone.

**Risk amplification:** Redis outages are most likely to happen under high load (exactly when attack traffic is high).

**Fix:** Add a secondary in-memory rate limit as a fallback. It won't survive process restarts but provides a local safety net:

```typescript
const inMemoryRateLimiter = new Map<string, number>();

if (redisDown) {
  const lastSent = inMemoryRateLimiter.get(phone);
  if (lastSent && Date.now() - lastSent < 60_000) {
    throw new MedusaError('OTP sent recently, please wait 60 seconds');
  }
  inMemoryRateLimiter.set(phone, Date.now());
}
```

---

### 🟠 VULN-07 — Refund Email Silently Fails for High-Volume Stores

**File:** `src/subscribers/webhooks-handler.ts` → `handleRefundProcessed()`  
**Code pattern:** `query.graph(payment, take: 500, created_at >= 6monthsAgo)`

The `take: 500` cap means that if more than 500 Razorpay payments were made in the last 6 months, the JS `.find()` scan will miss payments that fall outside the first 500 results. Affected customers **will never receive their refund confirmation email** — silently.

There is no error, no log, no fallback. The refund happens in Razorpay but Medusa silently does nothing.

**Fix:** Use cursor-based pagination to scan all payments:

```typescript
async function findPaymentByRazorpayId(razorpayPaymentId: string): Promise<Payment | null> {
  let offset = 0;
  const take = 100;
  while (true) {
    const payments = await query.graph({ entity: 'payment', ...filters, take, skip: offset });
    const match = payments.data.find(p => p.data?.razorpay_payment_id === razorpayPaymentId);
    if (match) return match;
    if (payments.data.length < take) return null;
    offset += take;
  }
}
```

---

### 🟠 VULN-08 — Stored XSS Risk in Review Display Name

**File:** `src/api/store/product-reviews/route.ts`  
**Flow:** `display_name` is injected from `auth_context` and written to DB

While injection from `auth_context` is correctly secured (can't be spoofed via request), the customer's actual name fields (set at registration) are not validated for HTML/JS content. A customer who registers as `<script>alert(1)</script>` will have that stored as their `display_name` in every review.

If the storefront renders reviews without sanitization (React `dangerouslySetInnerHTML` or server-side template), this is stored XSS.

**Fix:** Sanitize name fields at registration and again at display time:

```typescript
import DOMPurify from 'isomorphic-dompurify';
const safeDisplayName = DOMPurify.sanitize(authContext.actor_name, { ALLOWED_TAGS: [] });
```

---

### 🟠 VULN-09 — No Request Body Size Limits Documented

**All POST endpoints** accepting JSON bodies have no documented `express.json({ limit: '...' })` configuration. Without this, an attacker can send megabyte or gigabyte payloads to:
- `POST /store/carts/:id/line-items`
- `POST /hooks/razorpay` (also consumes memory before HMAC verification)
- `POST /store/product-reviews`

This can exhaust Node.js heap memory and crash the process.

**Fix:** In `medusa-config.ts` or custom middleware:

```typescript
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ limit: '100kb', extended: true }));
// Webhook endpoint needs raw body but can still be size-limited:
app.use('/hooks', express.raw({ limit: '1mb', type: 'application/json' }));
```

---

### 🟠 VULN-10 — Algolia Admin API Key in Environment (High-Blast-Radius Leak)

**Variable:** `ALGOLIA_API_KEY` — documented as "Admin API key for indexing"

An admin API key for Algolia can:
- Delete any index
- Create new API keys with any permissions
- Access query analytics and click data
- Modify index settings (e.g., turn off typo-tolerance to degrade search)

**Fix:** Create a scoped indexing key with only `addObject`, `deleteObject`, `editSettings` on the products index:

```bash
# Algolia create restricted key
curl -X POST "https://<APP_ID>.algolia.net/1/keys" \
  -H "X-Algolia-Application-Id: <APP_ID>" \
  -H "X-Algolia-API-Key: <ADMIN_KEY>" \
  -d '{
    "acl": ["addObject", "deleteObject"],
    "indexes": ["<PRODUCT_INDEX>"],
    "description": "Vridhira product sync"
  }'
```

---

### 🟡 VULN-11 — GA4 Service Account JSON in Single Env Var

**Variable:** `GA_SERVICE_ACCOUNT_KEY` — "Full service account JSON (single-line string)"

Storing an entire service account JSON (which includes a private RSA key) as a single env var is brittle and dangerous:
- Single env var leaks expose the entire private key
- JSON escaping errors can cause silent startup failures
- Rotation requires redeployment

**Fix:** Store the private key and client email separately, or use Google Workload Identity (if running on GCP/GKE). At minimum, scope the service account to `analytics.readonly` only and enable audit logging.

---

### 🟡 VULN-12 — No CSRF Protection on Session Cookie Auth

**File:** `src/api/middlewares.ts`

The system supports both JWT bearer tokens AND session cookies. Routes protected only by session cookie (without additional CSRF token) are vulnerable to CSRF attacks from other origins.

**Fix:** Implement SameSite=Strict or SameSite=Lax on session cookies (Medusa sets this, verify it's configured). Add CSRF token validation for any mutation that can use cookie auth.

---

### 🟡 VULN-13 — No Rate Limiting on Invoice PDF Generation

**Endpoint:** `GET /store/orders/:id/invoice`

PDF generation is CPU and memory intensive. An authenticated customer with many orders can hammer this endpoint, exhausting server resources. Since the check is only ownership-based (no throttling), this is a DoS vector from a legitimate account.

**Fix:**

```typescript
const invoiceRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.auth_context?.actor_id,
});
```

---

### 🟡 VULN-14 — Shiprocket Credentials as Plain-Text Long-Lived Env Vars

**Variables:** `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`

These are account credentials (not API keys). If leaked:
- Attacker gets full Shiprocket dashboard access
- Can reroute/cancel shipments
- Can access customer PII (addresses, phone numbers)
- Can exhaust API quota

The in-memory token is re-fetched on expiry — but with a single set of credentials with no rotation mechanism.

**Fix:** Use Shiprocket's service account feature if available. Rotate passwords regularly. Consider storing in a secrets manager (AWS Secrets Manager, Vault) with auto-rotation.

---

## PART 2 — Logical Gaps & Design Flaws

---

### 🟠 LOGIC-01 — Shiprocket Fulfillment Failure is Truly Silent

**File:** `src/subscribers/order-placed.ts`  
**Design:** "fire-and-forget — errors logged, do NOT fail the order"

This is the right approach for UX (not blocking order placement), but the current design has a critical operational gap: **there is no admin alert or retry queue when Shiprocket fulfillment fails**.

Scenarios where this silently fails:
- Shiprocket API is down at order time
- Product metadata (dimensions/weight) is malformed
- SHIPROCKET_PICKUP_LOCATION doesn't match any location in Shiprocket dashboard
- AWB assignment fails (no available couriers for that pincode)

The order exists in Medusa as "placed" with no fulfillment. Admin won't know until they manually check. For a high-order-volume store, these can pile up.

**Fix:** Implement a dead-letter queue or retry workflow:

```typescript
// In order-placed.ts subscriber
try {
  await createOrderFulfillmentWorkflow(container).run({ input });
} catch (error) {
  logger.error(`Shiprocket fulfillment failed for order ${orderId}:`, error);
  // Alert admin
  await sendAdminAlertWorkflow(container).run({
    input: { orderId, error: error.message, type: 'fulfillment_failed' }
  });
  // Queue for retry
  await redisClient.rpush('fulfillment:retry:queue', JSON.stringify({ orderId, attempt: 1 }));
}
```

---

### 🟠 LOGIC-02 — COD Order Has No Fulfillment Cancellation on Payment Capture Failure

**Flow:** On "delivered" webhook → `capturePaymentWorkflow` for COD

If `capturePaymentWorkflow` fails (DB error, Medusa internal error), the order is marked "Completed" and "Delivered" in Medusa, but the payment is never captured. The COD Remittance Tracker will silently show this order as pending forever.

There is no compensating action or alert.

**Fix:** Wrap the delivery + capture sequence in a compensatable workflow, or at minimum add an alert:

```typescript
try {
  await capturePaymentWorkflow(container).run({ input: { payment_id } });
} catch (error) {
  logger.error(`COD capture failed for order ${orderId}:`, error);
  // Mark for manual reconciliation
  await updateOrderMetadata(container, orderId, { cod_capture_failed: true, cod_capture_error: error.message });
  // Admin notification
  await sendAdminAlertWorkflow(container).run({ input: { orderId, type: 'cod_capture_failed' } });
}
```

---

### 🟠 LOGIC-03 — Refund Flow Relies on `latest return` Record — Fragile

**File:** `src/subscribers/webhooks-handler.ts` → `handleRefundProcessed()`  
**Pattern:** "find latest return record on the order (sorted by created_at desc)"

If an order has multiple partial refunds (common in e-commerce: item A refunded, then item B refunded), and two Razorpay `refund.processed` webhooks arrive close together, **both webhook handlers could resolve to the same "latest return"** record because the second DB write hasn't committed when the first handler queries.

This means one refund email gets sent twice and the other never gets sent.

**Fix:** Match refund by `razorpay_refund_id` from the webhook payload, not by order's latest return. Store `razorpay_refund_id` on the return/refund record.

---

### 🟠 LOGIC-04 — Multi-Instance Deployment Breaks In-Memory Caches

Three critical in-memory caches will not work correctly in a horizontally scaled deployment (multiple Node.js processes / PM2 cluster mode):

| Cache | Variable | Impact |
|---|---|---|
| Shiprocket token | In-memory singleton | Each instance fetches its own token → 2x–Nx API calls |
| GA4 OAuth token | In-memory + in-flight promise | Each instance refreshes independently → unnecessary Google API calls |
| GA4 report cache | In-memory 15-min cache | Each instance hits GA4 separately → inconsistent admin dashboard data per request |

**Fix:** Move all three caches to Redis:

```typescript
// Shiprocket token in Redis
const TOKEN_KEY = 'shiprocket:auth:token';
const cached = await redis.get(TOKEN_KEY);
if (cached) return cached;
const token = await fetchNewToken();
await redis.set(TOKEN_KEY, token, 'EX', 3600); // 1 hour
return token;
```

---

### 🟡 LOGIC-05 — COD OTP Brute Force Across Sessions

The brute-force lockout (5 attempts per session) is correct per-session. However, an attacker can:
1. Initiate a COD session → get 5 attempts
2. Session locks → initiate a NEW COD session (new payment_session_id)
3. Repeat

The 6-digit OTP space (10^6) / 5 attempts per session means ~200,000 sessions needed for guaranteed success, but they only need to be right *once*, and they can verify across sessions. Combined with multiple phone numbers, this is a distributed brute-force pattern.

**Fix:** Add a per-phone-number lockout in addition to per-session lockout:

```typescript
const phoneAttemptKey = `cod:otp:attempts:${normalizedPhone}`;
const phoneAttempts = await redis.incr(phoneAttemptKey);
await redis.expire(phoneAttemptKey, 3600); // 1 hour window
if (phoneAttempts > 20) {
  throw new MedusaError('Too many OTP attempts for this number. Try again in 1 hour.');
}
```

---

### 🟡 LOGIC-06 — Product Review Does Not Prevent Duplicate Reviews

**Endpoint:** `POST /store/product-reviews`  
**Middleware:** `requireVerifiedPurchase`

The middleware correctly verifies the customer bought the product, but there is no check preventing a customer from submitting 100 reviews for the same product (even if only one can be approved at a time). This allows:
- Review spam that requires admin to manually reject duplicates
- Potential abuse of the review system to game ratings if approval logic is ever changed

**Fix:** Add a unique constraint and an API check:

```sql
ALTER TABLE product_review ADD CONSTRAINT unique_customer_product UNIQUE (customer_id, product_id);
```

---

### 🟡 LOGIC-07 — Search Index Drift on Bulk Product Import

**Flow:** Manual reindex via `POST /admin/algolia/sync`

If an admin imports 500 products via Medusa's bulk import (or direct DB insert), `product.created` events fire for each. If the sync workflow fails partway through, some products are indexed and others aren't.

The only recovery is a full manual reindex from the Search Engine Manager — but there's no automated detection of drift, no scheduled sync, and no alerting.

**Fix:** Add a cron-based consistency check or nightly full sync:

```typescript
// schedule in medusa-config.ts
scheduledJobs: [
  {
    name: 'nightly-search-sync',
    schedule: '0 2 * * *', // 2 AM daily
    handler: 'nightly-search-sync',
  }
]
```

---

### 🟡 LOGIC-08 — COD Order Cancellation Edge Case

After COD order is placed (`otp_verified: true`, payment `authorized`):
- Payment status: authorized (not captured)
- Cash not yet collected

If admin cancels this order, `order.canceled` fires and a cancellation email is sent. But:
- Is the COD payment session explicitly voided/cancelled?
- Is there any protection against the delivery still happening (Shiprocket already has the order)?

The flow documents Shiprocket order creation as fire-and-forget, meaning Shiprocket may still dispatch the order even after Medusa marks it cancelled.

**Fix:** The `order-cancelled` subscriber should also call Shiprocket's cancel API:

```typescript
// src/subscribers/order-cancelled.ts
const fulfilmentData = order.fulfillments?.[0]?.data;
if (fulfilmentData?.shiprocket_order_id) {
  await shiprocketService.cancelOrder(fulfilmentData.shiprocket_order_id);
}
```

---

### 🟢 LOGIC-09 — No Webhook Replay Protection (Razorpay)

Razorpay webhooks are verified via HMAC-SHA256, which is correct. However, there is no nonce or timestamp check. A valid webhook payload could be captured and replayed later (e.g., replaying `payment.captured` after a refund was issued).

**Fix:** Check `X-Razorpay-Event-Id` header for uniqueness (store in Redis with TTL) or validate timestamp is within 5 minutes:

```typescript
const eventId = req.headers['x-razorpay-event-id'];
const seen = await redis.set(`razorpay:event:${eventId}`, '1', 'NX', 'EX', 86400);
if (!seen) return res.status(200).json({ received: true }); // idempotent skip
```

---

### 🔵 LOGIC-10 — Dimension/Weight Fallback May Violate Courier Rules

**Fallback:** `15×12×10 cm, 0.5 kg per item if metadata absent`

If a product's actual weight/dimensions differ significantly (e.g., a heavy appliance), the courier rate calculated at checkout (via serviceability API) will use actual metadata, but the Shiprocket order will be created with fallback values. This can lead to:
- Courier refusing pickup (weight mismatch)
- Additional charges applied by courier
- Disputes between Shiprocket, courier, and the store

**Fix:** Make missing dimension/weight metadata a **blocking validation** at product creation/update time, not a silent fallback.

---

## PART 3 — Potential Breakdown Points

---

### 💥 BREAK-01 — Shiprocket Token Expiry During Webhook Burst

**Scenario:** Large marketing campaign generates 200 orders in 5 minutes. All trigger `order.placed` simultaneously. Each calls `ShiprocketService.createFulfillment()`. If the Shiprocket token expires mid-burst, the singleton refreshes once — but due to JavaScript's event loop, multiple concurrent calls may each detect an expired token and try to refresh simultaneously, resulting in multiple concurrent login requests and possible token invalidation.

**Risk:** Some fulfillments succeed with the new token, others fail with the old one.

**Fix:** Implement a mutex on the Shiprocket token refresh (already partially addressed by the in-flight promise pattern on GA4 — apply same pattern to Shiprocket).

---

### 💥 BREAK-02 — PostgreSQL Connection Pool Exhaustion on Order Burst

**Scenario:** Same marketing campaign scenario. Each order triggers:
- `order-placed-email.ts` subscriber (1 query)
- `order-placed.ts` subscriber (3+ Shiprocket calls + multiple DB writes)
- GA4 plugin (1 query)

With 200 concurrent orders, this can saturate the Medusa connection pool (default: 10–20 connections), causing timeouts across the entire application, including unrelated customer browsing.

**Fix:** Configure separate connection pools for different workloads, or implement job queue processing with concurrency limits:

```typescript
// medusa-config.ts
database: {
  pool: { min: 5, max: 50 },
}
```

---

### 💥 BREAK-03 — Redis Single Point of Failure

**Redis is used for:**
1. COD OTP rate limiting (fail-open — OK)
2. Medusa job queues (fail-closed — critical)
3. GA4/Shiprocket token cache (if moved to Redis per fix above)

If Redis goes down completely, Medusa's event system (which uses Redis pub/sub) stops processing events. This means `order.placed` subscribers stop firing — no emails, no Shiprocket fulfillment. Orders pile up in the queue.

**Fix:** Use Redis Sentinel or Redis Cluster. Add a health check endpoint that validates Redis connectivity.

---

### 💥 BREAK-04 — Algolia/Meilisearch Sync Subscriber Stack on High Product Volume

The `product.created`/`product.updated` subscribers trigger per-product sync workflows. If an admin runs a bulk import of 1,000 products, 1,000 workflow instances queue simultaneously, potentially:
- Overwhelming Algolia's API rate limits
- Causing Medusa's job queue to back up
- Blocking other workflows (order processing)

**Fix:** Batch the sync — debounce rapid product events into a single bulk upsert with a short delay window, or use a separate lower-priority queue.

---

### 💥 BREAK-05 — GA4 Admin Dashboard Token Lock Under High Concurrency

**Current design:** In-flight promise deduplicates concurrent GA4 token requests (single instance).  
**Problem:** If the GA4 OAuth token endpoint is slow (>500ms), multiple admin users loading different GA4 tabs simultaneously may all queue on the same in-flight promise. If the promise rejects (Google API error), all queued admin requests fail simultaneously.

**Fix:** Add exponential backoff retry on the token fetch and persist the failure state to prevent thundering herd retry:

```typescript
let tokenFailedAt: number | null = null;
if (tokenFailedAt && Date.now() - tokenFailedAt < 30_000) {
  throw new Error('GA4 authentication temporarily unavailable');
}
```

---

## PART 4 — Known Third-Party Vulnerabilities

| Component | CVE/Advisory | Impact |
|---|---|---|
| `medusa-plugin-razorpay-v2` | Unverified — check npm audit | Payment bypass if signature validation has bugs |
| `@rsc-labs/medusa-documents-v2` | PDF library chain — check for prototype pollution | XSS in PDF or data leak |
| `@variablevic/google-analytics-medusa` | Unverified third-party plugin | GA4 API key exposure if plugin logs request data |
| Node.js `crypto.timingSafeEqual` | Correctly used, no known issues | — |
| Express.js | Check version via `npm audit` | Known SSRF/DoS in older versions |

**Recommendation:** Run `npm audit --audit-level=moderate` in CI on every PR.

---

## Summary Prioritization

| Priority | ID | Title | Effort |
|---|---|---|---|
| **P0 — Fix Now** | VULN-01 | Meilisearch master key | 30 min |
| **P0 — Fix Now** | VULN-03 | Cart completion race condition | 2 hours |
| **P0 — Fix Now** | VULN-05 | No auth rate limiting | 1 hour |
| **P1 — This Sprint** | VULN-02 | Shiprocket token in query string | 2 hours |
| **P1 — This Sprint** | VULN-04 | OAuth CSRF state validation | 1 hour |
| **P1 — This Sprint** | LOGIC-01 | Silent fulfillment failure | 3 hours |
| **P1 — This Sprint** | LOGIC-04 | Multi-instance cache breakage | 4 hours |
| **P2 — Next Sprint** | VULN-07 | Refund email silent fail | 2 hours |
| **P2 — Next Sprint** | VULN-06 | COD OTP fail-open Redis | 1 hour |
| **P2 — Next Sprint** | LOGIC-02 | COD capture failure | 2 hours |
| **P3 — Backlog** | All others | Various improvements | — |
