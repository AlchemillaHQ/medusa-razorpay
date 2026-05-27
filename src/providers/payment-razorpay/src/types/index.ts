import type { Orders } from "razorpay/dist/types/orders"

export interface RazorpayOptions {
    key_id: string
    key_secret: string
    razorpay_account: string
    automatic_expiry_period?: number
    manual_expiry_period?: number
    refund_speed?: "normal" | "optimum"
    auto_capture?: boolean
    webhook_secret: string
    automatic_payment_methods?: boolean
    payment_description?: string
}

export interface PaymentIntentOptions
    extends Orders.RazorpayOrderCreateRequestBody {
    capture_method?: "automatic" | "manual"
    setup_future_usage?: string
    payment_method_types?: string[]
}

export const PaymentProviderKeys = {
    RAZORPAY: "razorpay",
} as const

export const ErrorCodes = {
    PAYMENT_INTENT_UNEXPECTED_STATE: "payment_intent_unexpected_state",
    UNSUPPORTED_OPERATION: "unsupported_operation",
} as const

export const ErrorIntentStatus = {
    SUCCEEDED: "succeeded",
    CANCELED: "canceled",
} as const

export interface WebhookEventData {
    entity: string
    account_id: string
    event: string
    contains: string[]
    payload: {
        payment: {
            entity: PaymentEntity
        }
    }
    created_at: number
}

export interface PaymentEntity {
    id: string
    entity: string
    amount: number
    currency: string
    status: string
    order_id: string
    invoice_id: string | null
    international: boolean
    method: string
    amount_refunded: number
    refund_status: string | null
    captured: boolean
    description: string | null
    card_id: string | null
    bank: string | null
    wallet: string | null
    vpa: string | null
    email: string
    contact: string
    notes: Record<string, string>
    fee: number | null
    tax: number | null
    error_code: string | null
    error_description: string | null
    error_source: string | null
    error_step: string | null
    error_reason: string | null
    acquirer_data: {
        rrn?: string
        upi_transaction_id?: string
        bank_transaction_id?: string
    }
    created_at: number
    upi?: {
        vpa: string
    }
}
