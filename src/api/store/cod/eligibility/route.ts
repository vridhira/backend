import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import logger from "../../../../lib/logger"
import {
    codBlockedMessage,
    COD_MAX_STRIKES,
    COD_STRIKE1_CHECKOUT_WARNING,
    readCodMeta,
} from "../../../../lib/util/cod-fraud"

const log = logger.child({ module: "store/cod/eligibility" })

/**
 * GET /store/cod/eligibility
 *
 * Returns the authenticated customer's current COD eligibility status.
 *
 * Used by the checkout page to:
 *   - Hide COD option if customer is blocked
 *   - Show a warning banner if customer is on strike 1
 *
 * Response shapes:
 *   { eligible: true }
 *     → clean record, show COD normally
 *
 *   { eligible: true, strikes: 1, attempts_remaining: 1, checkout_warning: "..." }
 *     → strike 1, warn customer before they choose COD
 *
 *   { eligible: false, online_orders_needed: N, message: "..." }
 *     → blocked, hide COD or show disabled state with rehabilitation message
 *
 * Authentication: required (session or bearer)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const customerId = (req as any).auth_context?.actor_id as string | undefined

    if (!customerId) {
        return res.status(401).json({ message: "Unauthorized" })
    }

    try {
        const customerModule = req.scope.resolve(Modules.CUSTOMER) as any
        const customer = await customerModule.retrieveCustomer(customerId, {
            select: ["id", "metadata"],
        })

        const meta = readCodMeta(customer?.metadata)

        // ── Blocked ──────────────────────────────────────────────────────────
        if (meta.cod_blocked) {
            return res.status(200).json({
                eligible: false,
                online_orders_needed: meta.cod_online_orders_needed,
                message: codBlockedMessage(meta.cod_online_orders_needed),
            })
        }

        // ── Strike 1+ — warn but allow (uses >= 1 to handle any data drift) ─
        if (meta.cod_strike_count >= 1) {
            const attemptsRemaining = COD_MAX_STRIKES - meta.cod_strike_count
            return res.status(200).json({
                eligible: true,
                strikes: meta.cod_strike_count,
                attempts_remaining: attemptsRemaining,
                checkout_warning: COD_STRIKE1_CHECKOUT_WARNING,
            })
        }

        // ── Clean record ─────────────────────────────────────────────────
        return res.status(200).json({ eligible: true })
    } catch (err) {
        log.error({ err, customerId }, "Failed to retrieve COD eligibility")
        return res.status(500).json({ message: "Failed to check COD eligibility" })
    }
}
