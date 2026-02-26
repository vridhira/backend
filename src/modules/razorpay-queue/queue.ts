/**
 * Razorpay Event Queue — BullMQ Queue singleton
 *
 * This module exports a lazy-initialised BullMQ Queue used to:
 *  1. Receive Razorpay webhook payloads immediately after HMAC verification
 *  2. Persist them in Redis so a background Worker can process them asynchronously
 *
 * The Queue uses a DEDICATED IORedis connection because BullMQ connections must have
 * maxRetriesPerRequest: null (they issue blocking commands that would otherwise time out
 * when shared with a standard ioredis client that has maxRetriesPerRequest: 1).
 *
 * Usage:
 *   import { getRazorpayQueue } from "../modules/razorpay-queue/queue"
 *   await getRazorpayQueue().add("event", { eventId, event, payload })
 */

import { Queue } from "bullmq"
import IORedis from "ioredis"
import logger from "../../lib/logger"

const log = logger.child({ module: "razorpay-queue" })

let queueInstance: Queue | null = null
let connectionInstance: IORedis | null = null

function createBullMQConnection(): IORedis {
    const url = process.env.REDIS_URL
    if (!url) {
        throw new Error(
            "[RazorpayQueue] REDIS_URL is not configured. " +
            "Set REDIS_URL in your .env to enable async Razorpay webhook processing."
        )
    }

    const conn = new IORedis(url, {
        // REQUIRED for BullMQ — blocking commands (BRPOP, BLPOP) used internally
        // will throw immediately with maxRetriesPerRequest set to a finite number.
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
        keepAlive: 10000,
    })

    conn.on("error", (err: Error) => {
        log.error({ err }, "RazorpayQueue Redis connection error")
    })

    return conn
}

export function getRazorpayQueue(): Queue {
    if (!queueInstance) {
        connectionInstance = createBullMQConnection()

        queueInstance = new Queue("razorpay-events", {
            connection: connectionInstance,
            defaultJobOptions: {
                // Retry up to 3 times with exponential backoff (5s, 25s, 125s)
                // before the job is moved to the failed set.
                attempts: 3,
                backoff: { type: "exponential", delay: 5000 },
                // Keep a rolling window of processed jobs for debugging.
                removeOnComplete: { count: 200 },
                removeOnFail: { count: 500 },
            },
        })

        log.info("Razorpay event queue initialised")
    }

    return queueInstance
}
