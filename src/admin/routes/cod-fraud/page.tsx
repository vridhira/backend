import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ExclamationCircle } from "@medusajs/icons"
import {
    Badge,
    Button,
    Container,
    Heading,
    Input,
    Table,
    Text,
    toast,
} from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import React, { Fragment, useCallback, useRef, useState } from "react"
import { sdk } from "../../lib/sdk"

// ── Types ─────────────────────────────────────────────────────────────────────

type CodFraudRow = {
    customer_id: string
    customer_name: string
    customer_email: string
    cod_strike_count: number
    cod_blocked: boolean
    cod_online_orders_needed: number
    cod_last_strike_at: string | null
}

type CodFraudListResponse = {
    customers: CodFraudRow[]
    count: number
    offset: number
    limit: number
    stats: {
        total_flagged: number
        total_blocked: number
        total_warning: number
    }
}

type AdminAction = "add_strike" | "remove_strike" | "block" | "unblock"

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null) =>
    iso
        ? new Date(iso).toLocaleString("en-IN", {
              day: "2-digit", month: "short", year: "numeric",
              hour: "2-digit", minute: "2-digit",
          })
        : "—"

const MAX_STRIKES = 2

function StrikeDots({ count }: { count: number }) {
    return (
        <div className="flex items-center gap-1">
            {Array.from({ length: MAX_STRIKES }).map((_, i) => (
                <span
                    key={i}
                    className={[
                        "inline-block h-2.5 w-2.5 rounded-full border",
                        i < count
                            ? "bg-ui-tag-red-icon border-ui-tag-red-border"
                            : "bg-ui-bg-subtle border-ui-border-base",
                    ].join(" ")}
                />
            ))}
            <Text size="xsmall" className="ml-1 tabular-nums text-ui-fg-muted">
                {count}/{MAX_STRIKES}
            </Text>
        </div>
    )
}

const ACTION_CONFIG: Record<
    AdminAction,
    {
        label: string
        variant: "danger" | "secondary"
        description: string
        showWhen: (row: CodFraudRow) => boolean
    }
> = {
    add_strike: {
        label: "+ Add Strike",
        variant: "danger",
        description: "Records a fraud strike. At 2 strikes COD is auto-blocked and a notification is queued.",
        showWhen: (r) => !r.cod_blocked && r.cod_strike_count < MAX_STRIKES,
    },
    remove_strike: {
        label: "− Remove Strike",
        variant: "secondary",
        description: "Removes one strike. Does NOT auto-unblock — use Unblock COD for that.",
        showWhen: (r) => r.cod_strike_count > 0,
    },
    block: {
        label: "Block COD",
        variant: "danger",
        description: "Immediately disables COD. Customer gets a notification and must complete 3 online orders.",
        showWhen: (r) => !r.cod_blocked,
    },
    unblock: {
        label: "Unblock COD",
        variant: "secondary",
        description: "Restores full COD access, resets all strikes. Customer gets a notification.",
        showWhen: (r) => r.cod_blocked,
    },
}

// ── Action Panel ──────────────────────────────────────────────────────────────

function ActionPanel({
    row,
    onClose,
    onDone,
}: {
    row: CodFraudRow
    onClose: () => void
    onDone: () => void
}) {
    const [confirming, setConfirming] = useState<AdminAction | null>(null)
    const [reason, setReason] = useState("")

    const { mutate, isPending } = useMutation({
        mutationFn: ({ action, reason }: { action: AdminAction; reason?: string }) =>
            sdk.client.fetch(`/admin/custom/cod-fraud/${row.customer_id}`, {
                method: "POST",
                body: { action, ...(reason ? { reason } : {}) },
            }),
        onSuccess: (_r, { action }) => {
            const labels: Record<AdminAction, string> = {
                add_strike:    "Strike recorded",
                remove_strike: "Strike removed",
                block:         "COD blocked",
                unblock:       "COD unblocked",
            }
            toast.success(`${labels[action]} — notification queued for customer`)
            setConfirming(null)
            setReason("")
            onDone()
        },
        onError: (err: any) => {
            toast.error(err?.message ?? "Action failed")
        },
    })

    const availableActions = (Object.keys(ACTION_CONFIG) as AdminAction[]).filter(
        (a) => ACTION_CONFIG[a].showWhen(row)
    )

    return (
        <div className="mt-4 rounded-lg border border-ui-border-strong bg-ui-bg-subtle p-4 space-y-3">
            <div className="flex items-start justify-between">
                <div>
                    <Text size="small" weight="plus" className="text-ui-fg-base">
                        {row.customer_name}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-muted">{row.customer_email}</Text>
                </div>
                <Button variant="secondary" size="small" onClick={onClose} disabled={isPending}>
                    ✕
                </Button>
            </div>

            {!confirming ? (
                <div className="flex flex-wrap gap-2">
                    {availableActions.length === 0 ? (
                        <Text size="small" className="text-ui-fg-muted">No actions available</Text>
                    ) : (
                        availableActions.map((a) => (
                            <Button
                                key={a}
                                variant={ACTION_CONFIG[a].variant}
                                size="small"
                                onClick={() => { setConfirming(a); setReason("") }}
                            >
                                {ACTION_CONFIG[a].label}
                            </Button>
                        ))
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    <Text size="small" className="text-ui-fg-muted">
                        {ACTION_CONFIG[confirming].description}
                    </Text>
                    <Input
                        placeholder="Optional reason (internal note)"
                        size="small"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                    />
                    <Text size="xsmall" className="text-ui-fg-subtle">
                        A toast notification will be queued for the customer.
                    </Text>
                    <div className="flex gap-2">
                        <Button
                            variant={ACTION_CONFIG[confirming].variant}
                            size="small"
                            isLoading={isPending}
                            disabled={isPending}
                            onClick={() => mutate({ action: confirming, reason: reason || undefined })}
                        >
                            Confirm
                        </Button>
                        <Button
                            variant="secondary"
                            size="small"
                            disabled={isPending}
                            onClick={() => { setConfirming(null); setReason("") }}
                        >
                            Back
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const FILTER_OPTIONS: { label: string; value: string }[] = [
    { label: "Flagged",      value: "flagged" },
    { label: "Blocked Only", value: "blocked" },
    { label: "All Customers", value: "all"    },
]

const CodFraudPage = () => {
    const queryClient = useQueryClient()
    const [filter, setFilter]       = useState("flagged")
    const [search, setSearch]       = useState("")
    const [debouncedQ, setDebouncedQ] = useState("")
    const [offset, setOffset]       = useState(0)
    const [selected, setSelected]   = useState<string | null>(null)

    const LIMIT = 50
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleSearch = useCallback((val: string) => {
        setSearch(val)
        if (debounceTimer.current) clearTimeout(debounceTimer.current)
        debounceTimer.current = setTimeout(() => {
            setDebouncedQ(val)
            setOffset(0)
            setSelected(null)
        }, 300)
    }, [])

    const { data, isLoading, isFetching, isError } = useQuery<CodFraudListResponse>({
        queryKey: ["cod-fraud-list", filter, debouncedQ, offset],
        queryFn: () => {
            const qs = new URLSearchParams({
                filter,
                offset:  String(offset),
                limit:   String(LIMIT),
                ...(debouncedQ ? { q: debouncedQ } : {}),
            })
            return sdk.client.fetch(`/admin/custom/cod-fraud?${qs}`)
        },
        staleTime: 30_000,
        retry: false,
    })

    const customers  = data?.customers ?? []
    const totalCount = data?.count ?? 0
    const totalPages = Math.max(1, Math.ceil(totalCount / LIMIT))
    const currentPage = Math.floor(offset / LIMIT) + 1

    // Stats come from the full filtered set on the server — not just the current page
    const blockedCount = data?.stats?.total_blocked ?? 0
    const strike1Count = data?.stats?.total_warning ?? 0

    return (
        <div className="flex flex-col gap-4 p-6">

            {/* ── Header ──────────────────────────────────────────────── */}
            <div>
                <Heading level="h1">COD Fraud Management</Heading>
                <Text size="small" className="text-ui-fg-muted mt-1">
                    Manage Cash on Delivery access for customers. Actions queue a toast notification to the customer instantly.
                </Text>
            </div>

            {/* ── Stats bar ───────────────────────────────────────────── */}
            {/* Always rendered — blocked/warning counts are global (from the server's
                 flagged universe), so they remain correct regardless of active tab. */}
            <div className={["flex gap-4 transition-opacity duration-150", isFetching && !isLoading ? "opacity-50" : ""].join(" ").trim()}>
                <div className="rounded-lg border border-ui-border-base bg-ui-bg-base px-4 py-3 min-w-[120px]">
                    <Text size="xsmall" className="text-ui-fg-muted mb-0.5">
                        {filter === "all" ? "Showing" : filter === "blocked" ? "Blocked" : "Flagged"}
                    </Text>
                    <Text size="large" weight="plus" className="text-ui-fg-base">
                        {isLoading ? "—" : totalCount}
                    </Text>
                </div>
                <div className="rounded-lg border border-ui-tag-red-border bg-ui-tag-red-bg px-4 py-3 min-w-[120px]">
                    <Text size="xsmall" className="text-ui-fg-muted mb-0.5">Total Blocked</Text>
                    <Text size="large" weight="plus" className="text-ui-tag-red-text">
                        {isLoading ? "—" : blockedCount}
                    </Text>
                </div>
                <div className="rounded-lg border border-ui-tag-orange-border bg-ui-tag-orange-bg px-4 py-3 min-w-[120px]">
                    <Text size="xsmall" className="text-ui-fg-muted mb-0.5">Warnings</Text>
                    <Text size="large" weight="plus" className="text-ui-tag-orange-text">
                        {isLoading ? "—" : strike1Count}
                    </Text>
                </div>
            </div>

            {/* ── Filters + Search ────────────────────────────────────── */}
            <Container className="p-0">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ui-border-base">
                    <div className="flex gap-1">
                        {FILTER_OPTIONS.map((opt) => (
                            <Button
                                key={opt.value}
                                variant={filter === opt.value ? "primary" : "transparent"}
                                size="small"
                                onClick={() => { setFilter(opt.value); setOffset(0); setSelected(null) }}
                            >
                                {opt.label}
                            </Button>
                        ))}
                    </div>
                    <Input
                        placeholder="Search by email…"
                        size="small"
                        className="max-w-xs"
                        value={search}
                        onChange={(e) => handleSearch(e.target.value)}
                    />
                </div>

                {/* ── Table ───────────────────────────────────────────── */}
                <Table className={isFetching && !isLoading ? "opacity-60 pointer-events-none" : ""}>
                    <Table.Header>
                        <Table.Row>
                            <Table.HeaderCell>Customer</Table.HeaderCell>
                            <Table.HeaderCell>Status</Table.HeaderCell>
                            <Table.HeaderCell>Strikes</Table.HeaderCell>
                            <Table.HeaderCell>Unlock Remaining</Table.HeaderCell>
                            <Table.HeaderCell>Last Strike</Table.HeaderCell>
                            <Table.HeaderCell />
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {isLoading && (
                            <Table.Row>
                                <Table.Cell {...({ colSpan: 6 } as React.TdHTMLAttributes<HTMLTableCellElement>)}>
                                    <Text size="small" className="text-ui-fg-muted py-2">Loading…</Text>
                                </Table.Cell>
                            </Table.Row>
                        )}
                        {isError && (
                            <Table.Row>
                                <Table.Cell {...({ colSpan: 6 } as React.TdHTMLAttributes<HTMLTableCellElement>)}>
                                    <Text size="small" className="text-ui-fg-subtle py-2">Failed to load customers</Text>
                                </Table.Cell>
                            </Table.Row>
                        )}
                        {!isLoading && !isError && customers.length === 0 && (
                            <Table.Row>
                                <Table.Cell {...({ colSpan: 6 } as React.TdHTMLAttributes<HTMLTableCellElement>)}>
                                    <Text size="small" className="text-ui-fg-muted py-2">
                                        {filter === "all" ? "No customers found" : "No flagged customers 🎉"}
                                    </Text>
                                </Table.Cell>
                            </Table.Row>
                        )}
                        {customers.map((row) => (
                            <Fragment key={row.customer_id}>
                                <Table.Row
                                    className="cursor-pointer"
                                    onClick={() =>
                                        setSelected(selected === row.customer_id ? null : row.customer_id)
                                    }
                                >
                                    <Table.Cell>
                                        <div>
                                            <Text size="small" weight="plus" className="text-ui-fg-base">
                                                {row.customer_name}
                                            </Text>
                                            <Text size="xsmall" className="text-ui-fg-muted">
                                                {row.customer_email}
                                            </Text>
                                        </div>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Badge
                                            color={row.cod_blocked ? "red" : row.cod_strike_count > 0 ? "orange" : "green"}
                                            size="xsmall"
                                        >
                                            {row.cod_blocked ? "Blocked" : row.cod_strike_count > 0 ? "Warning" : "Active"}
                                        </Badge>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <StrikeDots count={row.cod_strike_count} />
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Text size="small" className="text-ui-fg-base tabular-nums">
                                            {row.cod_blocked ? `${row.cod_online_orders_needed} order${row.cod_online_orders_needed !== 1 ? "s" : ""}` : "—"}
                                        </Text>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Text size="small" className="text-ui-fg-base">
                                            {fmtDate(row.cod_last_strike_at)}
                                        </Text>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Text size="xsmall" className="text-ui-fg-interactive">
                                            {selected === row.customer_id ? "▲ Close" : "▼ Manage"}
                                        </Text>
                                    </Table.Cell>
                                </Table.Row>
                                {selected === row.customer_id && (
                                    <Table.Row>
                                        <Table.Cell {...({ colSpan: 6, className: "bg-ui-bg-subtle" } as React.TdHTMLAttributes<HTMLTableCellElement>)}>
                                            <ActionPanel
                                                row={row}
                                                onClose={() => setSelected(null)}
                                                onDone={() => {
                                                    queryClient.invalidateQueries({ queryKey: ["cod-fraud-list"] })
                                                    setSelected(null)
                                                }}
                                            />
                                        </Table.Cell>
                                    </Table.Row>
                                )}
                            </Fragment>
                        ))}
                    </Table.Body>
                </Table>

                {/* ── Pagination ──────────────────────────────────────── */}
                {totalCount > LIMIT && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-ui-border-base">
                        <Text size="small" className="text-ui-fg-muted">
                            Page {currentPage} of {totalPages} · {totalCount} total
                        </Text>
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                size="small"
                                disabled={offset === 0}
                                onClick={() => { setOffset(Math.max(0, offset - LIMIT)); setSelected(null) }}
                            >
                                ← Previous
                            </Button>
                            <Button
                                variant="secondary"
                                size="small"
                                disabled={offset + LIMIT >= totalCount}
                                onClick={() => { setOffset(offset + LIMIT); setSelected(null) }}
                            >
                                Next →
                            </Button>
                        </div>
                    </div>
                )}
            </Container>
        </div>
    )
}

export const config = defineRouteConfig({
    label: "COD Fraud",
    icon: ExclamationCircle,
})

export default CodFraudPage
