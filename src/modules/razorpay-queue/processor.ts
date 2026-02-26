/**
 * Razorpay Event Queue — Job Processor
 *
 * Handles Razorpay webhook payloads that have been dequeued from BullMQ.
 *
 * Security: Idempotency is enforced via a per-event Redis key
 * (razorpay:event:{eventId}) so Razorpay's retry attempts do not process an
 * event twice, even if the Worker restarts between retries.
 *
 * Each event type:
 *   payment.authorized — logged only (medusa-plugin-razorpay-v2 handles capture)
 *   payment.captured   — logged only (fulfillment triggered by order.placed subscriber)
 *   payment.failed     — logged as warning
 *   refund.processed   — looks up Medusa order and sends refund-initiated email
 */

import type { Job } from "bullmq"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getRedisClient } from "../../lib/redis-client"
import { sendOrderRefundedWorkflow } from "../../workflows/send-order-refunded"
import logger from "../../lib/logger"

const log = logger.child({ module: "razorpay-processor" })

// Razorpay webhooks can be retried up to several hours after the initial delivery.
// Keep the idempotency key for 24 hours.
const IDEMPOTENCY_TTL_SECS = 86_400

export function createRazorpayProcessor(container: any) {
    return async (job: Job): Promise<string> => {
        const { eventId, event, payload } = job.data as {
            eventId: string
            event: string
            payload: Record<string, any>
        }

        // ── Idempotency guard ────────────────────────────────────────────
        // SET NX EX: atomic — only succeeds for the FIRST worker to claim this event.
        let redis
        try {
            redis = getRedisClient()
            const idempotencyKey = `razorpay:event:${eventId}`
            const claimed = await redis.set(idempotencyKey, "1", "NX", "EX", String(IDEMPOTENCY_TTL_SECS))
            if (claimed === null) {
                log.info({ eventId, event, jobId: job.id }, "Razorpay event already processed — skipping duplicate")
                return "duplicate"
            }
        } catch (redisErr) {
            // If Redis is unavailable we CANNOT guarantee idempotency.
            // Fail-closed: rethrow so BullMQ retries with backoff rather than
            // silently processing a potentially duplicate event.
            log.error({ err: redisErr, eventId, event }, "Cannot acquire idempotency lock — failing job for retry")
            throw redisErr
        }

        // ── Event routing ────────────────────────────────────────────────
        const paymentEntity = payload?.payment?.entity as Record<string, any> | undefined
        const refundEntity  = payload?.refund?.entity  as Record<string, any> | undefined

        switch (event) {
            case "payment.authorized":
                log.info(
                    { paymentId: paymentEntity?.id, amount: paymentEntity?.amount },
                    "Payment authorized — medusa-plugin-razorpay-v2 handles capture"
                )
                break

            case "payment.captured":
                log.info(
                    { paymentId: paymentEntity?.id, orderId: paymentEntity?.order_id },
                    "Payment captured — fulfillment triggered by order.placed subscriber"
                )
                break

            case "payment.failed":
                log.warn(
                    {
                        paymentId: paymentEntity?.id,
                        errorCode: paymentEntity?.error_code,
                        errorDescription: paymentEntity?.error_description,
                    },
                    "Payment failed — customer notified by Razorpay UI; no backend action"
                )
                break

            case "refund.processed":
                await handleRefundProcessed(container, { refundEntity, paymentEntity })
                break

            default:
                log.info({ event }, "Unhandled Razorpay event type — acknowledged but not processed")
        }

        return "processed"
    }
}

// ── Refund Handler ─────────────────────────────────────────────────────────────

async function handleRefundProcessed(
    container: any,
    {
        refundEntity,
        paymentEntity,
    }: {
        refundEntity?: Record<string, any>
        paymentEntity?: Record<string, any>
    }
) {
    const razorpayPaymentId = refundEntity?.payment_id ?? paymentEntity?.id
    const refundId          = refundEntity?.id
    const refundAmount      = refundEntity?.amount ?? 0  // in paise

    log.info(
        { refundId, razorpayPaymentId, amountInr: refundAmount / 100 },
        "Processing refund.processed event"
    )

    if (!razorpayPaymentId) {
        log.warn("refund.processed event missing payment_id — cannot look up order")
        return
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // ── Look up Medusa payment by Razorpay payment ID ─────────────────────
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
    const PAGE_SIZE    = 100
    let   skip         = 0
    let   matchedPayment: Record<string, any> | undefined

    while (!matchedPayment) {
        const { data: payments } = await query.graph({
            entity: "payment",
            fields: ["id", "payment_collection_id", "data"],
            filters: {
                provider_id: "pp_razorpay_razorpay",
                created_at: { $gte: sixMonthsAgo },
            } as any,
            pagination: { take: PAGE_SIZE, skip },
        })

        if (!payments || payments.length === 0) break

        matchedPayment = payments.find(
            (p: any) =>
                p?.data?.id === razorpayPaymentId ||
                p?.data?.razorpay_payment_id === razorpayPaymentId
        )

        if (payments.length < PAGE_SIZE) break
        skip += PAGE_SIZE
    }

    if (!matchedPayment) {
        log.warn(
            { razorpayPaymentId },
            "No Medusa payment found for Razorpay payment_id — cannot send refund email"
        )
        return
    }

    // ── Find the order via payment_collection → order link ─────────────────
    const { data: collections } = await query.graph({
        entity: "payment_collection",
        fields: ["id", "order.*"],
        filters: { id: matchedPayment.payment_collection_id },
    })

    const order = (collections[0] as any)?.order
    if (!order?.id) {
        log.warn(
            { paymentCollectionId: matchedPayment.payment_collection_id },
            "No order linked to payment_collection"
        )
        return
    }

    log.info({ orderId: order.id, displayId: order.display_id }, "Refund mapped to Medusa order")

    // ── Find a return linked to this order ─────────────────────────────────
    const { data: returns } = await query.graph({
        entity: "return",
        fields: ["id", "refund_amount", "created_at"],
        filters: { order_id: order.id },
    })

    if (returns.length > 0) {
        const sortedReturns = [...returns].sort(
            (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        const latestReturn = sortedReturns[0] as any
        log.info({ returnId: latestReturn.id }, "Sending refund email for return")

        await sendOrderRefundedWorkflow(container).run({
            input: { id: latestReturn.id },
        })
    } else {
        // Direct refund from Razorpay dashboard — no formal return record
        log.info({ orderId: order.id }, "No return record found — sending direct refund notification")

        // Convert paise → rupees for email template (fmt() expects major currency unit)
        await sendOrderRefundedWorkflow(container).run({
            input: { id: order.id, directRefundAmount: refundAmount / 100, isDirectRefund: true },
        })
    }
}
