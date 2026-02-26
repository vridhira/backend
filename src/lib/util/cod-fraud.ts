/**
 * COD Fraud / Reputation System — shared constants and helpers
 *
 * Strike system overview:
 *
 *   Grace period: customer may freely cancel a COD order until the courier
 *   PICKS IT UP from the warehouse. Once Shiprocket reports status "Shipped"
 *   (or any later stage), cancellation counts as a strike.
 *
 *   Strike 1 → warning flag set. Checkout shows "1 attempt remaining".
 *   Strike 2 → COD blocked. Customer must complete 3 online orders to unlock.
 *
 *   Strike count is CUMULATIVE — online payments between strikes do not reset it.
 *
 * Customer metadata fields (all stored under customer.metadata):
 *
 *   cod_strike_count          number  0|1|2     — total COD violations
 *   cod_blocked               boolean           — hard block flag
 *   cod_online_orders_needed  number            — remaining online orders to unlock
 *   cod_last_strike_at        string (ISO date) — timestamp of most recent strike
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum strikes before COD is disabled */
export const COD_MAX_STRIKES = 2

/** Online orders required to re-enable COD after a block */
export const COD_UNLOCK_ORDERS_REQUIRED = 3

/** Payment provider IDs for COD (both resolved and bare) */
export const COD_PROVIDER_IDS = new Set(["pp_cod_cod", "cod"])

// ── Status helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true if the Shiprocket shipment has been picked up by the courier.
 * "Shipped" = courier collected from warehouse = grace period over.
 *
 * Handles the various capitalizations Shiprocket uses in practice.
 * The raw status string is stored in order.metadata.shiprocket_status.
 */
export function isCodPickedUp(shiprocketStatus: string | undefined | null): boolean {
    if (!shiprocketStatus) return false
    const s = shiprocketStatus.toLowerCase().trim()
    // Any status past "pending" indicates the courier has taken custody of the package.
    // "shipped" = courier collected; "in transit", "out for delivery", "delivered" = even further along.
    return (
        s === "shipped" ||
        s === "in transit" ||
        s === "in-transit" ||
        s === "out for delivery" ||
        s === "out_for_delivery" ||
        s === "delivered"
    )
}

// ── Metadata accessors ─────────────────────────────────────────────────────────

export type CodFraudMeta = {
    cod_strike_count: number
    cod_blocked: boolean
    cod_online_orders_needed: number
    cod_last_strike_at: string | null
}

export function readCodMeta(metadata: Record<string, unknown> | null | undefined): CodFraudMeta {
    const m = metadata ?? {}
    return {
        cod_strike_count:         Number(m.cod_strike_count ?? 0),
        cod_blocked:              m.cod_blocked === true,
        cod_online_orders_needed: Number(m.cod_online_orders_needed ?? 0),
        cod_last_strike_at:       (m.cod_last_strike_at as string) ?? null,
    }
}

/**
 * Returns the user-facing error message when COD is blocked.
 */
export function codBlockedMessage(onlineOrdersNeeded: number): string {
    const n = onlineOrdersNeeded > 0 ? onlineOrdersNeeded : COD_UNLOCK_ORDERS_REQUIRED
    return (
        `Due to repeated COD order cancellations after pickup, Cash on Delivery has been disabled on your account. ` +
        `You can still place orders using online payment (UPI, cards, net banking). ` +
        `Complete ${n} successful online order${n !== 1 ? "s" : ""} to re-enable COD.`
    )
}

/**
 * Returns the checkout warning message for a customer with exactly 1 strike.
 */
export const COD_STRIKE1_CHECKOUT_WARNING =
    "Warning: You have 1 COD attempt remaining. A further cancellation after pickup will permanently disable Cash on Delivery on your account."

/**
 * Returns the toast/modal message shown when a customer tries to cancel a COD
 * order that has already been picked up (the act that would trigger Strike 1).
 */
export const COD_CANCELLATION_WARNING_TOAST =
    "This order has already been picked up by the courier. Cancelling it will count as a COD violation and may permanently disable Cash on Delivery on your account. Are you sure you want to continue?"
