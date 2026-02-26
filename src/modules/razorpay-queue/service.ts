/**
 * Razorpay Event Queue — Minimal Medusa Service
 *
 * The Medusa Module system requires a service class. This service is intentionally
 * empty — the queue and worker logic live in queue.ts, processor.ts, and loader.ts.
 * The Module is registered in medusa-config.ts to trigger the loader on startup.
 */

export class RazorpayQueueService {
    static identifier = "razorpay-queue-service"
}

export default RazorpayQueueService
