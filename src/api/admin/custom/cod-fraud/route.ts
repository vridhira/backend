import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import logger from "../../../../lib/logger"
import { readCodMeta } from "../../../../lib/util/cod-fraud"

const log = logger.child({ module: "admin/cod-fraud/list" })

/**
 * GET /admin/custom/cod-fraud
 *
 * Lists customers that have any COD fraud activity.
 *
 * Query params:
 *   filter  = "all" | "flagged" | "blocked"   (default: "flagged")
 *   q       = email/name search string
 *   offset  = number (default 0)
 *   limit   = number (default 50, max 200)
 *
 * Response:
 *   { customers: CodFraudRow[], count: number, offset: number, limit: number }
 */
const VALID_FILTERS = new Set(["all", "flagged", "blocked"])

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    // Validate + parse inputs — guard against NaN and unknown values
    const rawFilter = req.query.filter as string
    const filter = VALID_FILTERS.has(rawFilter) ? rawFilter : "flagged"

    const q = (req.query.q as string) || ""

    const rawOffset = parseInt((req.query.offset as string) || "0", 10)
    const rawLimit  = parseInt((req.query.limit  as string) || "50", 10)
    const offset = isNaN(rawOffset) || rawOffset < 0  ? 0  : rawOffset
    const limit  = isNaN(rawLimit)  || rawLimit  < 1  ? 50 : Math.min(200, rawLimit)

    try {
        const customerModule = req.scope.resolve(Modules.CUSTOMER) as any

        // Email prefix search — Medusa's customer module can only filter by scalar columns.
        const where: Record<string, unknown> = {}
        if (q.trim()) {
            where.email = { $ilike: `%${q.trim()}%` }
        }

        // Fetch a broad batch for in-app metadata filtering.
        // Medusa's ORM doesn't expose JSONB path queries, so we pull more rows and
        // filter/paginate in JavaScript.  2 000 covers virtually all real stores;
        // a q-search narrows the DB result first so the cap rarely bites.
        const fetchBatch = Math.min(2000, limit * 40)

        const customers = await customerModule.listCustomers(where, {
            select: ["id", "first_name", "last_name", "email", "metadata", "created_at"],
            take: fetchBatch,
            skip: 0,
        })

        const mapped = customers.map((c: any) => {
            const meta = readCodMeta(c.metadata)
            return {
                customer_id: c.id,
                customer_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "—",
                customer_email: c.email ?? "—",
                cod_strike_count: meta.cod_strike_count,
                cod_blocked: meta.cod_blocked,
                cod_online_orders_needed: meta.cod_online_orders_needed,
                cod_last_strike_at: meta.cod_last_strike_at,
            }
        })

        // Stats are ALWAYS derived from the full flagged universe — not from the
        // currently-active filter tab — so the blocked / warning counts in the stats
        // bar remain accurate regardless of which tab the admin is viewing.
        const flaggedAll: typeof mapped = mapped.filter(
            (r: any) => r.cod_strike_count > 0 || r.cod_blocked
        )
        const stats = {
            total_flagged: flaggedAll.length,
            total_blocked: flaggedAll.filter((r: any) => r.cod_blocked).length,
            total_warning: flaggedAll.filter((r: any) => r.cod_strike_count > 0 && !r.cod_blocked).length,
        }

        // Derive table rows from the pre-computed sets (no second pass needed)
        const rows: typeof mapped =
            filter === "blocked" ? flaggedAll.filter((r: any) => r.cod_blocked) :
            filter === "flagged" ? flaggedAll :
            mapped  // "all"

        // Sort: blocked first → most strikes → most recent strike
        rows.sort((a: any, b: any) => {
            if (a.cod_blocked !== b.cod_blocked) return a.cod_blocked ? -1 : 1
            if (a.cod_strike_count !== b.cod_strike_count) return b.cod_strike_count - a.cod_strike_count
            const aTime = a.cod_last_strike_at ? new Date(a.cod_last_strike_at).getTime() : 0
            const bTime = b.cod_last_strike_at ? new Date(b.cod_last_strike_at).getTime() : 0
            return bTime - aTime
        })

        return res.status(200).json({
            customers: rows.slice(offset, offset + limit),
            count: rows.length,
            offset,
            limit,
            stats,
        })
    } catch (err) {
        log.error({ err }, "Failed to list COD fraud customers")
        return res.status(500).json({ message: "Failed to list customers" })
    }
}
