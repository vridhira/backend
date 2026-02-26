/**
 * retryWithBackoff — Generic in-process retry with exponential backoff
 *
 * Retries the given async function on ANY thrown error, waiting exponentially
 * longer between each attempt. All errors are retried (no discrimination by type)
 * because transient infrastructure failures (Shiprocket 503, auth token expiry)
 * produce different error shapes that are hard to discriminate safely.
 *
 * Usage:
 *   const result = await retryWithBackoff(
 *     () => shiprocket.generateAWB(shipmentId),
 *     { attempts: 3, baseDelayMs: 2000, factor: 2 }
 *   )
 *   // Total max wait before giving up: 2s + 4s = 6s, then final attempt throws.
 *
 * The last attempt's error is re-thrown unchanged so callers receive the original
 * MedusaError / Error from the failing function.
 */

import logger from "../logger"

const log = logger.child({ module: "retry" })

export interface RetryOptions {
    /** Total number of attempts (including the first try). Must be >= 1. */
    attempts: number
    /** Delay in milliseconds before the second attempt. Doubles each retry. */
    baseDelayMs: number
    /** Multiplier for backoff. Default 2 = exponential doubling. */
    factor?: number
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    opts: RetryOptions
): Promise<T> {
    const { attempts, baseDelayMs, factor = 2 } = opts

    if (attempts < 1) throw new Error("retryWithBackoff: attempts must be >= 1")

    let lastError: unknown
    let delayMs = baseDelayMs

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn()
        } catch (err) {
            lastError = err
            if (attempt < attempts) {
                log.warn(
                    { attempt, maxAttempts: attempts, delayMs, errMessage: (err as Error)?.message },
                    "retryWithBackoff: attempt failed — retrying after delay"
                )
                await sleep(delayMs)
                delayMs = delayMs * factor
            }
        }
    }

    // All attempts exhausted — re-throw the last error
    throw lastError
}
