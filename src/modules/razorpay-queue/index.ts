/**
 * Razorpay Event Queue Module
 *
 * Registers the BullMQ Worker loader so it starts when Medusa boots.
 * The Worker asynchronously processes Razorpay webhook payloads that were
 * enqueued by the POST /hooks/razorpay endpoint after HMAC verification.
 *
 * Register in medusa-config.ts:
 *   { resolve: "./src/modules/razorpay-queue" }
 */

import { Module } from "@medusajs/framework/utils"
import RazorpayQueueService from "./service"
import { razorpayQueueLoader } from "./loader"

export { getRazorpayQueue } from "./queue"

export default Module("razorpay_queue_module", {
    service: RazorpayQueueService,
    loaders: [razorpayQueueLoader],
})
