import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelOrderWorkflow } from "@medusajs/core-flows"
import { Modules, MedusaError } from "@medusajs/framework/utils"
import logger from "../../../../../lib/logger"

const log = logger.child({ module: "store/orders/cancel" })

/**
 * POST /store/orders/:id/cancel
 *
 * Customer-initiated order cancellation.
 *
 * Stamps order.metadata.cancelled_by = "customer" BEFORE cancelling so that
 * the cod-fraud-tracker subscriber can distinguish customer cancellations from
 * admin-initiated ones. Admin cancellations (via admin panel) never set this
 * flag, so they never trigger a fraud strike.
 *
 * Constraints enforced by cancelOrderWorkflow:
 *   - Order must not have any active (non-cancelled) fulfillments
 *   - Order must not already be cancelled
 *
 * Authentication: required (session or bearer)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const customerId = (req as any).auth_context?.actor_id as string | undefined

    if (!customerId) {
        return res.status(401).json({ message: "Unauthorized" })
    }

    const { id: orderId } = req.params as { id: string }

    try {
        const orderModule = req.scope.resolve(Modules.ORDER) as any

        let order: any
        try {
            order = await orderModule.retrieveOrder(orderId, { select: ["id", "customer_id", "status", "metadata"] })
        } catch {
            return res.status(404).json({ message: "Order not found" })
        }

        // ── Ownership check ───────────────────────────────────────────────
        if (order.customer_id !== customerId) {
            return res.status(404).json({ message: "Order not found" })
        }

        // ── Already cancelled ─────────────────────────────────────────────
        if (order.status === "canceled") {
            return res.status(400).json({ message: "Order is already cancelled" })
        }

        // ── Stamp actor BEFORE cancelling ─────────────────────────────────
        // The cod-fraud-tracker subscriber reads this flag to decide whether
        // to apply a strike. Without it, admin cancellations would also count.
        await orderModule.updateOrders(orderId, {
            metadata: {
                ...order.metadata,
                cancelled_by: "customer",
            },
        })

        // ── Cancel ────────────────────────────────────────────────────────
        await cancelOrderWorkflow(req.scope).run({ input: { order_id: orderId } })

        log.info({ orderId, customerId }, "Customer cancelled order")

        return res.status(200).json({ message: "Order cancelled successfully" })
    } catch (err) {
        if (err instanceof MedusaError) {
            // e.g. "Order has active fulfillments and cannot be cancelled"
            return res.status(400).json({ message: err.message })
        }
        log.error({ err, orderId, customerId }, "Failed to cancel order")
        return res.status(500).json({ message: "Failed to cancel order" })
    }
}
