import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text } from "@medusajs/ui"
import type { HttpTypes } from "@medusajs/framework/types"

type WidgetProps = {
    data: {
        order: HttpTypes.AdminOrder
    }
}

function RazorpayPaymentDetailsWidget({ data }: WidgetProps) {
    const order = data.order as any

    const razorpayPayments =
        order.payment_collections
            ?.flatMap((collection: any) => collection.payment_sessions ?? [])
            .filter(
                (session: any) =>
                    session?.provider_id?.startsWith("pp_razorpay") &&
                    session?.data?.razorpayOrder
            ) ?? []

    if (razorpayPayments.length === 0) {
        return null
    }

    return (
        <Container className="divide-y p-0">
            <div className="flex items-center justify-between px-6 py-4">
                <Heading level="h2">Razorpay Payment</Heading>
            </div>
            {razorpayPayments.map((session: any) => {
                const rzpOrder = session.data?.razorpayOrder
                if (!rzpOrder) return null

                return (
                    <div key={session.id} className="px-6 py-4 space-y-3">
                        <DetailRow label="Order ID" value={rzpOrder.id} />
                        <DetailRow
                            label="Amount"
                            value={`${(Number(rzpOrder.amount) / 100).toFixed(2)} ${(rzpOrder.currency ?? "").toUpperCase()}`}
                        />
                        <DetailRow label="Status" value={rzpOrder.status} />
                        <DetailRow
                            label="Amount Paid"
                            value={`${(Number(rzpOrder.amount_paid) / 100).toFixed(2)} ${(rzpOrder.currency ?? "").toUpperCase()}`}
                        />
                        <DetailRow
                            label="Amount Due"
                            value={`${(Number(rzpOrder.amount_due) / 100).toFixed(2)} ${(rzpOrder.currency ?? "").toUpperCase()}`}
                        />
                    </div>
                )
            })}
        </Container>
    )
}

function DetailRow({
    label,
    value,
}: {
    label: string
    value?: string | number
}) {
    if (value === undefined || value === null || value === "") return null

    return (
        <div className="flex items-start justify-between gap-x-2 text-sm">
            <Text size="small" className="text-ui-fg-subtle">
                {label}
            </Text>
            <Text size="small" className="text-ui-fg-base text-right">
                {String(value)}
            </Text>
        </div>
    )
}

export const config = defineWidgetConfig({
    zone: "order.details.side.after",
})

export default RazorpayPaymentDetailsWidget
