import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, MedusaError } from "@medusajs/framework/utils"
import crypto from "crypto"
import logger from "../../../../../lib/logger"
import {
    codBlockedMessage,
    COD_MAX_STRIKES,
    COD_UNLOCK_ORDERS_REQUIRED,
    readCodMeta,
} from "../../../../../lib/util/cod-fraud"

const log = logger.child({ module: "admin/cod-fraud" })

// ── Witty notification messages for each admin action ─────────────────────────
// Delivered as a toast to the customer on their next page load.

function notificationMessage(action: AdminAction, newStrikeCount: number): string {
    switch (action) {
        case "add_strike":
            if (newStrikeCount >= COD_MAX_STRIKES) {
                return `Oops, that's two post-pickup COD cancellations too many! 🧊 Your COD access has been put on ice — but it's not permanent. Complete ${COD_UNLOCK_ORDERS_REQUIRED} online orders and you're back in the game. UPI pe try karo!`
            }
            return `Heads up! ☝️ One of your COD orders was flagged for a late cancellation. Consider this Strike 1 — you've got one more chance before COD takes a little vacation from your account. We're rooting for you, promise.`

        case "remove_strike":
            return `Clean slate incoming! ✅ Our team reviewed your account and removed a COD strike. Consider this your second wind — we're keeping the faith. Deliver karte raho!`

        case "block":
            return `Your COD access has been paused by our team. 🚫 We noticed some concerns with recent orders. No worries — UPI and cards work perfectly for now. Reach out to support if you think this is a mistake.`

        case "unblock":
            return `Great news! 🎉 Your COD access is back — fully restored, no strings attached. Consider this a fresh start. Ab seedha deliver karne do!`
    }
}

type AdminAction = "add_strike" | "remove_strike" | "block" | "unblock"

type CodFraudPostBody = {
    action: AdminAction
    reason?: string
}

// ── GET /admin/custom/cod-fraud/:customerId ────────────────────────────────────
// Returns the current COD fraud status for a customer.

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const { customerId } = req.params as { customerId: string }

    try {
        const customerModule = req.scope.resolve(Modules.CUSTOMER) as any
        const customer = await customerModule.retrieveCustomer(customerId, {
            select: ["id", "first_name", "last_name", "email", "metadata"],
        })

        const meta = readCodMeta(customer?.metadata)

        return res.status(200).json({
            customer_id: customerId,
            customer_name: [customer.first_name, customer.last_name].filter(Boolean).join(" ") || "—",
            customer_email: customer.email ?? "—",
            cod_strike_count: meta.cod_strike_count,
            cod_blocked: meta.cod_blocked,
            cod_online_orders_needed: meta.cod_online_orders_needed,
            cod_last_strike_at: meta.cod_last_strike_at,
            max_strikes: COD_MAX_STRIKES,
            unlock_orders_required: COD_UNLOCK_ORDERS_REQUIRED,
        })
    } catch (err) {
        log.error({ err, customerId }, "Failed to fetch COD fraud status")
        return res.status(404).json({ message: "Customer not found" })
    }
}

// ── POST /admin/custom/cod-fraud/:customerId ──────────────────────────────────
// Modify COD fraud flags and queue a witty notification to the customer.
//
// Body: { action: "add_strike" | "remove_strike" | "block" | "unblock", reason?: string }

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const { customerId } = req.params as { customerId: string }
    const { action, reason } = req.body as CodFraudPostBody

    const validActions: AdminAction[] = ["add_strike", "remove_strike", "block", "unblock"]
    if (!action || !validActions.includes(action)) {
        return res.status(400).json({
            message: `action must be one of: ${validActions.join(", ")}`,
        })
    }

    try {
        const customerModule = req.scope.resolve(Modules.CUSTOMER) as any
        const customer = await customerModule.retrieveCustomer(customerId, {
            select: ["id", "metadata"],
        })

        const meta = readCodMeta(customer?.metadata)
        const existingNotifications: any[] = (customer.metadata?.cod_pending_notifications as any[]) ?? []

        let newMeta: Record<string, unknown> = { ...customer.metadata }
        let newStrikeCount = meta.cod_strike_count

        switch (action) {
            case "add_strike": {
                newStrikeCount = Math.min(meta.cod_strike_count + 1, COD_MAX_STRIKES)
                const willBlock = newStrikeCount >= COD_MAX_STRIKES
                newMeta = {
                    ...newMeta,
                    cod_strike_count: newStrikeCount,
                    cod_blocked: willBlock || meta.cod_blocked,
                    cod_online_orders_needed: willBlock ? COD_UNLOCK_ORDERS_REQUIRED : meta.cod_online_orders_needed,
                    cod_last_strike_at: new Date().toISOString(),
                }
                break
            }
            case "remove_strike": {
                newStrikeCount = Math.max(meta.cod_strike_count - 1, 0)
                newMeta = {
                    ...newMeta,
                    cod_strike_count: newStrikeCount,
                    // Only unblock if this removal brings strikes below threshold
                    cod_blocked: newStrikeCount >= COD_MAX_STRIKES,
                    cod_online_orders_needed: newStrikeCount >= COD_MAX_STRIKES ? meta.cod_online_orders_needed : 0,
                }
                break
            }
            case "block": {
                newMeta = {
                    ...newMeta,
                    cod_blocked: true,
                    cod_strike_count: Math.max(meta.cod_strike_count, COD_MAX_STRIKES),
                    cod_online_orders_needed: COD_UNLOCK_ORDERS_REQUIRED,
                    cod_last_strike_at: new Date().toISOString(),
                }
                newStrikeCount = COD_MAX_STRIKES
                break
            }
            case "unblock": {
                newMeta = {
                    ...newMeta,
                    cod_blocked: false,
                    cod_strike_count: 0,
                    cod_online_orders_needed: 0,
                }
                newStrikeCount = 0
                break
            }
        }

        // ── Queue notification for customer ───────────────────────────────
        const notification = {
            id: crypto.randomUUID(),
            message: notificationMessage(action, newStrikeCount),
            type: action,
            created_at: new Date().toISOString(),
            ...(reason ? { reason } : {}),
        }
        newMeta.cod_pending_notifications = [...existingNotifications, notification]

        await customerModule.updateCustomers(customerId, { metadata: newMeta })

        log.info({ customerId, action, newStrikeCount }, `Admin COD fraud action: ${action}`)

        const updatedMeta = readCodMeta(newMeta)
        return res.status(200).json({
            success: true,
            action,
            cod_strike_count: updatedMeta.cod_strike_count,
            cod_blocked: updatedMeta.cod_blocked,
            cod_online_orders_needed: updatedMeta.cod_online_orders_needed,
            notification_queued: notification.message,
        })
    } catch (err) {
        if (err instanceof MedusaError) {
            return res.status(400).json({ message: err.message })
        }
        log.error({ err, customerId, action }, "Failed to update COD fraud flags")
        return res.status(500).json({ message: "Failed to update COD fraud flags" })
    }
}
