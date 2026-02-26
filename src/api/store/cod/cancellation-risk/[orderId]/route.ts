import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import logger from "../../../../../lib/logger"
import {
    codBlockedMessage,
    COD_CANCELLATION_WARNING_TOAST,
    COD_MAX_STRIKES,
    COD_PROVIDER_IDS,
    COD_UNLOCK_ORDERS_REQUIRED,
    isCodPickedUp,
    readCodMeta,
} from "../../../../../lib/util/cod-fraud"

const log = logger.child({ module: "store/cod/cancellation-risk" })

/**
 * GET /store/cod/cancellation-risk/:orderId
 *
 * Pre-cancellation warning check. Call this before showing the "Cancel Order"
 * confirmation dialog so the storefront can warn the customer about fraud strikes.
 *
 * Response shapes:
 *
 *   { at_risk: false }
 *     → Order hasn't been picked up yet. Safe to cancel with no consequences.
 *
 *   { at_risk: true, would_trigger_strike: 1, attempts_remaining: 1, warning: "..." }
 *     → Courier has the parcel. Cancelling now records strike 1 — one chance left.
 *
 *   { at_risk: true, would_trigger_block: true, warning: "...", message: "..." }
 *     → Already at strike 1. Cancelling now will permanently block COD until
 *       3 online orders are completed.
 *
 * Authentication: required (session or bearer)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const customerId = (req as any).auth_context?.actor_id as string | undefined

    if (!customerId) {
        return res.status(401).json({ message: "Unauthorized" })
    }

    const { orderId } = req.params as { orderId: string }

    if (!orderId || typeof orderId !== "string" || orderId.trim().length === 0) {
        return res.status(400).json({ message: "Invalid orderId" })
    }

    try {
        const orderModule = req.scope.resolve(Modules.ORDER) as any

        let order: any
        try {
            order = await orderModule.retrieveOrder(orderId, {
                relations: ["payment_collections", "payment_collections.payments"],
            })
        } catch {
            return res.status(404).json({ message: "Order not found" })
        }

        // ── Ownership check ───────────────────────────────────────────────
        if (order.customer_id !== customerId) {
            // Return 404 to avoid leaking that the order exists
            return res.status(404).json({ message: "Order not found" })
        }

        // ── Guard: COD orders only ────────────────────────────────────────
        const payments: any[] =
            order.payment_collections?.flatMap((pc: any) => pc.payments ?? []) ?? []
        const isCodOrder = payments.some((p: any) => COD_PROVIDER_IDS.has(p.provider_id))

        if (!isCodOrder) {
            // Non-COD orders never have fraud implications
            return res.status(200).json({ at_risk: false })
        }

        // ── Check if parcel has been picked up ────────────────────────────
        const shiprocketStatus = order.metadata?.shiprocket_status as string | undefined
        if (!isCodPickedUp(shiprocketStatus)) {
            return res.status(200).json({ at_risk: false })
        }

        // ── Parcel is in transit — determine current strike level ─────────
        const customerModule = req.scope.resolve(Modules.CUSTOMER) as any
        const customer = await customerModule.retrieveCustomer(customerId, {
            select: ["id", "metadata"],
        })
        const meta = readCodMeta(customer?.metadata)

        // ── Already blocked — no new strike will be added by fraud-tracker ─
        if (meta.cod_blocked) {
            return res.status(200).json({
                at_risk: true,
                already_blocked: true,
                warning: COD_CANCELLATION_WARNING_TOAST,
                message: codBlockedMessage(meta.cod_online_orders_needed),
            })
        }

        const strikeAfterCancel = meta.cod_strike_count + 1
        const wouldBlock = strikeAfterCancel >= COD_MAX_STRIKES

        if (wouldBlock) {
            return res.status(200).json({
                at_risk: true,
                would_trigger_block: true,
                warning: COD_CANCELLATION_WARNING_TOAST,
                message: codBlockedMessage(COD_UNLOCK_ORDERS_REQUIRED),
            })
        }

        return res.status(200).json({
            at_risk: true,
            would_trigger_strike: strikeAfterCancel,
            attempts_remaining: COD_MAX_STRIKES - strikeAfterCancel,
            warning: COD_CANCELLATION_WARNING_TOAST,
        })
    } catch (err) {
        log.error({ err, customerId, orderId }, "Failed to check COD cancellation risk")
        return res.status(500).json({ message: "Failed to check cancellation risk" })
    }
}
