import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import logger from "../../../../lib/logger"

const log = logger.child({ module: "store/cod/notifications" })

/**
 * GET /store/cod/notifications
 *
 * Returns any pending COD-related notifications queued by the admin panel
 * (e.g. strike added, blocked, unblocked) and atomically clears them.
 *
 * The storefront calls this on page load (or periodically) and renders each
 * notification as a toast. Since the array is cleared on read, each message
 * is shown exactly once.
 *
 * Response:
 *   { notifications: Array<{ id, message, type, created_at }> }
 *
 * Empty response (no pending notifications):
 *   { notifications: [] }
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

        const pending: any[] = (customer?.metadata?.cod_pending_notifications as any[]) ?? []

        if (pending.length === 0) {
            return res.status(200).json({ notifications: [] })
        }

        // Clear atomically — write empty array back before returning
        await customerModule.updateCustomers(customerId, {
            metadata: {
                ...customer.metadata,
                cod_pending_notifications: [],
            },
        })

        log.debug({ customerId, count: pending.length }, "Delivered and cleared COD notifications")

        return res.status(200).json({ notifications: pending })
    } catch (err) {
        log.error({ err, customerId }, "Failed to fetch COD notifications")
        return res.status(500).json({ message: "Failed to fetch notifications" })
    }
}
