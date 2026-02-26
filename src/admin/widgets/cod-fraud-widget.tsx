import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { sdk } from "../lib/sdk"

// ── Types ─────────────────────────────────────────────────────────────────────

type CodFraudStatus = {
    customer_id: string
    customer_name: string
    customer_email: string
    cod_strike_count: number
    cod_blocked: boolean
    cod_online_orders_needed: number
    cod_last_strike_at: string | null
    max_strikes: number
    unlock_orders_required: number
}

type AdminAction = "add_strike" | "remove_strike" | "block" | "unblock"

// ── Helpers ───────────────────────────────────────────────────────────────────

const COD_PROVIDER_IDS = new Set(["pp_cod_cod", "cod"])

function isCodOrder(order: AdminOrder): boolean {
    return (order as any).payment_collections
        ?.flatMap((pc: any) => pc.payments ?? [])
        .some((p: any) => COD_PROVIDER_IDS.has(p.provider_id)) ?? false
}

const fmtDate = (iso: string | null) =>
    iso
        ? new Date(iso).toLocaleString("en-IN", {
              day: "2-digit", month: "short", year: "numeric",
              hour: "2-digit", minute: "2-digit",
          })
        : "—"

const ACTION_CONFIG: Record<
    AdminAction,
    {
        label: string
        confirmLabel: string
        description: string
        variant: "danger" | "secondary"
        showWhen: (s: CodFraudStatus) => boolean
    }
> = {
    add_strike: {
        label: "+ Add Strike",
        confirmLabel: "Confirm Strike",
        description: "Records a fraud strike on the customer. At 2 strikes, COD is auto-blocked and a notification is sent.",
        variant: "danger",
        showWhen: (s) => !s.cod_blocked && s.cod_strike_count < s.max_strikes,
    },
    remove_strike: {
        label: "− Remove Strike",
        confirmLabel: "Confirm Removal",
        description: "Removes one strike. This will NOT auto-unblock — use Unblock COD for that.",
        variant: "secondary",
        showWhen: (s) => s.cod_strike_count > 0,
    },
    block: {
        label: "Block COD",
        confirmLabel: "Confirm Block",
        description: "Immediately disables COD for this customer. A notification is sent asking them to use online payment.",
        variant: "danger",
        showWhen: (s) => !s.cod_blocked,
    },
    unblock: {
        label: "Unblock COD",
        confirmLabel: "Confirm Unblock",
        description: "Restores full COD access. Resets all strikes. A notification is sent to the customer.",
        variant: "secondary",
        showWhen: (s) => s.cod_blocked,
    },
}

// ── Strike indicator (dots) ───────────────────────────────────────────────────

function StrikeDots({ count, max }: { count: number; max: number }) {
    return (
        <div className="flex items-center gap-1.5">
            {Array.from({ length: max }).map((_, i) => (
                <span
                    key={i}
                    className={[
                        "inline-block h-3 w-3 rounded-full border",
                        i < count
                            ? "bg-ui-tag-red-icon border-ui-tag-red-border"
                            : "bg-ui-bg-subtle border-ui-border-base",
                    ].join(" ")}
                />
            ))}
            <Text size="xsmall" className="ml-1 text-ui-fg-muted">
                {count} / {max}
            </Text>
        </div>
    )
}

// ── Main Widget ───────────────────────────────────────────────────────────────
//
// Zone: order.details.after
// Visible only on COD orders with a registered customer.
// Fetches COD fraud status from /admin/custom/cod-fraud/:customerId and allows
// the admin to add/remove strikes or block/unblock COD, with a witty notification
// queued for the customer on each action.

const CodFraudWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
    const customerId = (order as any).customer_id as string | undefined
    const queryClient = useQueryClient()
    const [pending, setPending] = useState<AdminAction | null>(null)

    // Computed before hooks — used as the `enabled` guard below
    const isCod = !!customerId && isCodOrder(order)

    // ── Fetch fraud status ────────────────────────────────────────────────
    // Hooks must be called unconditionally (Rules of Hooks).
    // enabled:isCod ensures no fetch fires for non-COD / guest orders.
    const { data: status, isLoading, isError, refetch } = useQuery<CodFraudStatus>({
        queryKey: ["cod-fraud", customerId ?? ""],
        queryFn: () => sdk.client.fetch(`/admin/custom/cod-fraud/${customerId}`),
        enabled: isCod,
        staleTime: 30_000,
        retry: false,
    })

    // ── Apply action ──────────────────────────────────────────────────────
    const { mutate: applyAction, isPending: applying } = useMutation({
        mutationFn: (action: AdminAction) =>
            sdk.client.fetch<{ notification_queued: string }>(
                `/admin/custom/cod-fraud/${customerId}`,
                { method: "POST", body: { action } }
            ),
        onSuccess: (_result, action) => {
            setPending(null)
            queryClient.invalidateQueries({ queryKey: ["cod-fraud", customerId] })
            const labels: Record<AdminAction, string> = {
                add_strike:    "Strike recorded",
                remove_strike: "Strike removed",
                block:         "COD blocked",
                unblock:       "COD unblocked",
            }
            toast.success(`${labels[action]} — notification queued for customer`)
        },
        onError: (err: any) => {
            setPending(null)
            toast.error(err?.message ?? "Action failed")
        },
    })

    // Early return AFTER all hooks (Rules of Hooks requires unconditional hook calls)
    if (!isCod) return null

    // ── Render ────────────────────────────────────────────────────────────
    return (
        <Container className="divide-y p-0">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4">
                <div>
                    <Heading level="h2">COD Fraud Management</Heading>
                    {status && (
                        <Text size="small" className="text-ui-fg-muted mt-0.5">
                            {status.customer_name} · {status.customer_email}
                        </Text>
                    )}
                </div>
                <Button variant="secondary" size="small" onClick={() => refetch()} disabled={isLoading}>
                    Refresh
                </Button>
            </div>

            {/* Body */}
            <div className="px-6 py-4">

                {isLoading && (
                    <Text size="small" className="text-ui-fg-muted">Loading…</Text>
                )}

                {isError && (
                    <Text size="small" className="text-ui-fg-subtle">
                        Failed to load COD fraud status
                    </Text>
                )}

                {!isLoading && !isError && status && (
                    <div className="space-y-5">

                        {/* Status overview */}
                        <div className="grid grid-cols-2 gap-x-8 gap-y-4">

                            <div>
                                <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1.5">
                                    COD Access
                                </Text>
                                <Badge
                                    color={status.cod_blocked ? "red" : status.cod_strike_count > 0 ? "orange" : "green"}
                                    size="xsmall"
                                >
                                    {status.cod_blocked
                                        ? "Blocked"
                                        : status.cod_strike_count > 0
                                        ? "Warning"
                                        : "Active"}
                                </Badge>
                            </div>

                            <div>
                                <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1.5">
                                    Strikes
                                </Text>
                                <StrikeDots count={status.cod_strike_count} max={status.max_strikes} />
                            </div>

                            {status.cod_blocked && (
                                <div>
                                    <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                                        Unlock Remaining
                                    </Text>
                                    <Text size="small" className="text-ui-fg-base font-medium">
                                        {status.cod_online_orders_needed} online order{status.cod_online_orders_needed !== 1 ? "s" : ""}
                                    </Text>
                                </div>
                            )}

                            <div>
                                <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                                    Last Strike
                                </Text>
                                <Text size="small" className="text-ui-fg-base">
                                    {fmtDate(status.cod_last_strike_at)}
                                </Text>
                            </div>

                        </div>

                        {/* Confirmation prompt */}
                        {pending && (
                            <div className="rounded-lg border border-ui-border-strong bg-ui-bg-subtle p-4 space-y-2">
                                <Text size="small" weight="plus" className="text-ui-fg-base">
                                    {ACTION_CONFIG[pending].confirmLabel}
                                </Text>
                                <Text size="small" className="text-ui-fg-muted">
                                    {ACTION_CONFIG[pending].description}
                                </Text>
                                <Text size="xsmall" className="text-ui-fg-subtle">
                                    A toast notification will be queued for the customer.
                                </Text>
                                <div className="flex gap-2 pt-1">
                                    <Button
                                        variant={ACTION_CONFIG[pending].variant}
                                        size="small"
                                        isLoading={applying}
                                        disabled={applying}
                                        onClick={() => applyAction(pending)}
                                    >
                                        {ACTION_CONFIG[pending].confirmLabel}
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="small"
                                        disabled={applying}
                                        onClick={() => setPending(null)}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Action buttons */}
                        {!pending && (
                            <div className="flex flex-wrap gap-2 pt-1">
                                {(Object.keys(ACTION_CONFIG) as AdminAction[])
                                    .filter((a) => ACTION_CONFIG[a].showWhen(status))
                                    .map((action) => (
                                        <Button
                                            key={action}
                                            variant={ACTION_CONFIG[action].variant}
                                            size="small"
                                            onClick={() => setPending(action)}
                                        >
                                            {ACTION_CONFIG[action].label}
                                        </Button>
                                    ))}
                            </div>
                        )}

                    </div>
                )}
            </div>

        </Container>
    )
}

export const config = defineWidgetConfig({
    zone: "order.details.after",
})

export default CodFraudWidget
