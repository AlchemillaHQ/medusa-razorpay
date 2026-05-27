import Razorpay from "razorpay"
import type { Orders } from "razorpay/dist/types/orders"
import type { Payments } from "razorpay/dist/types/payments"
import {
    AbstractPaymentProvider,
    isDefined,
    MedusaError,
    Modules,
    PaymentActions,
    PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
    Logger,
    ProviderWebhookPayload,
} from "@medusajs/framework/types"
import type {
    InitiatePaymentInput,
    InitiatePaymentOutput,
    AuthorizePaymentInput,
    AuthorizePaymentOutput,
    CapturePaymentInput,
    CapturePaymentOutput,
    CancelPaymentInput,
    CancelPaymentOutput,
    DeletePaymentInput,
    DeletePaymentOutput,
    RefundPaymentInput,
    RefundPaymentOutput,
    RetrievePaymentInput,
    RetrievePaymentOutput,
    UpdatePaymentInput,
    UpdatePaymentOutput,
    GetPaymentStatusInput,
    GetPaymentStatusOutput,
    CreateAccountHolderInput,
    CreateAccountHolderOutput,
    UpdateAccountHolderInput,
    UpdateAccountHolderOutput,
    DeleteAccountHolderInput,
    DeleteAccountHolderOutput,
    WebhookActionResult,
    PaymentCustomerDTO,
    BigNumberInput,
} from "@medusajs/framework/types"
import type { IPaymentModuleService } from "@medusajs/framework/types"

import type { RazorpayOptions } from "../types"
import { getSmallestUnit } from "../utils/currency"
import { updateRazorpayCustomerMetadataWorkflow } from "../workflows/update-razorpay-customer-metadata"

export abstract class RazorpayBase extends AbstractPaymentProvider<RazorpayOptions> {
    static identifier = "razorpay"

    protected options_: RazorpayOptions
    protected razorpay_: Razorpay
    protected logger_: Logger

    constructor(container: Record<string, any>, options: RazorpayOptions) {
        super(container, options)

        this.options_ = options
        this.logger_ = (container as any).logger ?? console
        this.init()
    }

    protected init(): void {
        this.razorpay_ = new Razorpay({
            key_id: this.options_.key_id,
            key_secret: this.options_.key_secret,
            headers: {
                "Content-Type": "application/json",
                "X-Razorpay-Account": this.options_.razorpay_account,
            },
        })
    }

    static validateOptions(options: RazorpayOptions): void {
        if (!isDefined(options.key_id)) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "key_id is required"
            )
        }
        if (!isDefined(options.key_secret)) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "key_secret is required"
            )
        }
        if (!isDefined(options.razorpay_account)) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "razorpay_account is required"
            )
        }
        if (
            !isDefined(options.automatic_expiry_period) &&
            !isDefined(options.manual_expiry_period)
        ) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "Either automatic_expiry_period or manual_expiry_period is required"
            )
        }
        if (!isDefined(options.webhook_secret)) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "webhook_secret is required"
            )
        }
    }

    protected getToPay(
        amount: BigNumberInput,
        currency_code: string
    ): number {
        return getSmallestUnit(amount, currency_code)
    }

    protected getRazorpayOrderCreateRequestBody(
        amount: number,
        currency_code: string
    ): Orders.RazorpayOrderCreateRequestBody {
        const body: Orders.RazorpayOrderCreateRequestBody = {
            amount,
            currency: currency_code.toUpperCase(),
            notes: {},
        }

        if (this.options_.auto_capture) {
            body.payment = {
                ...(body.payment as any),
                capture: "automatic" as any,
            }
            if (this.options_.automatic_expiry_period) {
                ;(body.payment as any).capture_options = {
                    ...(body.payment as any)?.capture_options,
                    automatic_expiry_period:
                        this.options_.automatic_expiry_period,
                }
            }
        } else {
            body.payment = {
                ...(body.payment as any),
                capture: "manual" as any,
            }
            if (this.options_.manual_expiry_period) {
                ;(body.payment as any).capture_options = {
                    ...(body.payment as any)?.capture_options,
                    manual_expiry_period:
                        this.options_.manual_expiry_period,
                }
            }
        }

        if (this.options_.automatic_payment_methods) {
            ;(body as any).automatic_payment_methods = true
        }

        return body
    }

    async getPaymentStatus(
        input: GetPaymentStatusInput
    ): Promise<GetPaymentStatusOutput> {
        const razorpayOrder = input.data
            ?.razorpayOrder as Orders.RazorpayOrder
        if (!razorpayOrder) {
            return { status: PaymentSessionStatus.PENDING }
        }

        const order = await this.razorpay_.orders.fetch(razorpayOrder.id)
        const payments =
            await this.razorpay_.orders.fetchPayments(razorpayOrder.id)

        if (!order) {
            return { status: PaymentSessionStatus.PENDING }
        }

        switch (order.status) {
            case "paid":
                return {
                    status: PaymentSessionStatus.AUTHORIZED,
                }
            case "created":
                if (!payments || payments.count === 0) {
                    return { status: PaymentSessionStatus.REQUIRES_MORE }
                }
                return {
                    status: this.getRazorpayPaymentStatus(
                        payments as unknown as Payments.RazorpayPayment[],
                        razorpayOrder
                    ),
                }
            case "attempted":
                if (!payments || payments.count === 0) {
                    return { status: PaymentSessionStatus.ERROR }
                }
                return {
                    status: this.getRazorpayPaymentStatus(
                        payments as unknown as Payments.RazorpayPayment[],
                        razorpayOrder
                    ),
                }
            default:
                return { status: PaymentSessionStatus.PENDING }
        }
    }

    private getRazorpayPaymentStatus(
        payments: Payments.RazorpayPayment[],
        razorpayOrder: Orders.RazorpayOrder
    ): PaymentSessionStatus {
        const authorizedAmount = payments
            .filter(
                (p) =>
                    p.status === "authorized" ||
                    p.status === "captured"
            )
            .reduce((sum, p) => sum + Number(p.amount), 0)

        if (authorizedAmount >= Number(razorpayOrder.amount)) {
            return PaymentSessionStatus.AUTHORIZED
        }

        const hasFailed = payments.some((p) => p.status === "failed")
        if (hasFailed && authorizedAmount === 0) {
            return PaymentSessionStatus.ERROR
        }

        return PaymentSessionStatus.REQUIRES_MORE
    }

    async initiatePayment(
        input: InitiatePaymentInput
    ): Promise<InitiatePaymentOutput> {
        const razorpayOrderInput = this.getRazorpayOrderCreateRequestBody(
            this.getToPay(input.amount, input.currency_code),
            input.currency_code
        )

        const razorpayOrder = await this.razorpay_.orders.create(
            razorpayOrderInput
        )

        return {
            data: { razorpayOrder },
            id: razorpayOrder.id,
        }
    }

    async authorizePayment(
        input: AuthorizePaymentInput
    ): Promise<AuthorizePaymentOutput> {
        const statusResult = await this.getPaymentStatus(input)
        const status = statusResult.status
        const razorpayOrder = input.data
            ?.razorpayOrder as Orders.RazorpayOrder

        if (
            this.options_.auto_capture &&
            status === PaymentSessionStatus.AUTHORIZED &&
            razorpayOrder
        ) {
            try {
                const paymentsResponse =
                    await this.razorpay_.orders.fetchPayments(
                        razorpayOrder.id
                    )
                const payments =
                    paymentsResponse as unknown as Payments.RazorpayPayment[]

                for (const payment of payments) {
                    if (payment.status === "authorized") {
                        await this.razorpay_.payments.capture(
                            payment.id,
                            payment.amount,
                            payment.currency
                        )
                    }
                }
            } catch (error) {
                this.logger_?.error(
                    `Failed to auto-capture payment: ${error}`
                )
            }
        }

        return {
            data: { razorpayOrder },
            status,
        }
    }

    async capturePayment(
        input: CapturePaymentInput
    ): Promise<CapturePaymentOutput> {
        const razorpayOrder = input.data
            ?.razorpayOrder as Orders.RazorpayOrder
        if (!razorpayOrder) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "No Razorpay order found"
            )
        }

        const paymentsResponse =
            await this.razorpay_.orders.fetchPayments(razorpayOrder.id)
        const payments =
            paymentsResponse as unknown as Payments.RazorpayPayment[]

        const authorizedPayments = payments.filter(
            (p) => p.status === "authorized"
        )

        if (authorizedPayments.length === 0) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "No authorized payments to capture"
            )
        }

        for (const payment of authorizedPayments) {
            await this.razorpay_.payments.capture(
                payment.id,
                payment.amount,
                payment.currency
            )
        }

        const updatedOrder = await this.razorpay_.orders.fetch(
            razorpayOrder.id
        )

        return {
            data: { razorpayOrder: updatedOrder },
        }
    }

    async cancelPayment(
        input: CancelPaymentInput
    ): Promise<CancelPaymentOutput> {
        const razorpayOrder = input.data
            ?.razorpayOrder as Orders.RazorpayOrder
        if (!razorpayOrder) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "No Razorpay order found"
            )
        }

        const paymentsResponse =
            await this.razorpay_.orders.fetchPayments(razorpayOrder.id)
        const payments =
            paymentsResponse as unknown as Payments.RazorpayPayment[]

        const capturedPayments = payments.filter(
            (p) => p.status === "captured"
        )
        if (capturedPayments.length > 0) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "Cannot cancel an order with captured payments"
            )
        }

        const results: any[] = []
        for (const payment of payments) {
            if (payment.status === "authorized") {
                const refund = await this.razorpay_.payments.refund(
                    payment.id,
                    { amount: payment.amount }
                )
                results.push(refund)
            }
        }

        const updatedOrder = await this.razorpay_.orders.fetch(
            razorpayOrder.id
        )

        return {
            data: {
                razorpayOrder: updatedOrder,
                refunds: results,
            },
        }
    }

    async deletePayment(
        input: DeletePaymentInput
    ): Promise<DeletePaymentOutput> {
        try {
            return await this.cancelPayment(input as any)
        } catch (error) {
            this.logger_?.warn(
                `Failed to cancel during deletePayment: ${error}`
            )
            return { data: input.data ?? {} }
        }
    }

    async refundPayment(
        input: RefundPaymentInput
    ): Promise<RefundPaymentOutput> {
        const razorpayOrder = input.data
            ?.razorpayOrder as Orders.RazorpayOrder
        const amount = input.amount as number | undefined

        if (!razorpayOrder) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "No Razorpay order found"
            )
        }

        const paymentsResponse =
            await this.razorpay_.orders.fetchPayments(razorpayOrder.id)
        const payments =
            paymentsResponse as unknown as Payments.RazorpayPayment[]

        const eligiblePayment = payments.find(
            (p) =>
                (p.status === "captured" ||
                    p.status === "authorized") &&
                (!amount || Number(p.amount) >= amount)
        )

        if (!eligiblePayment) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "No eligible payment found for refund"
            )
        }

        const refundAmount = amount || eligiblePayment.amount
        const refund = await this.razorpay_.payments.refund(
            eligiblePayment.id,
            { amount: refundAmount }
        )

        const updatedOrder = await this.razorpay_.orders.fetch(
            razorpayOrder.id
        )

        return {
            data: {
                razorpayOrder: updatedOrder,
                razorpayRefundSession: refund,
            },
        }
    }

    async retrievePayment(
        input: RetrievePaymentInput
    ): Promise<RetrievePaymentOutput> {
        const razorpayOrder = input.data
            ?.razorpayOrder as Orders.RazorpayOrder

        if (!razorpayOrder) {
            return { data: input.data ?? {} }
        }

        const order = await this.razorpay_.orders.fetch(razorpayOrder.id)
        return { data: { razorpayOrder: order } }
    }

    async updatePayment(
        input: UpdatePaymentInput
    ): Promise<UpdatePaymentOutput> {
        const razorpayOrder = input.data
            ?.razorpayOrder as Orders.RazorpayOrder
        const paymentSessionId = input.context?.idempotency_key

        if (razorpayOrder && paymentSessionId) {
            await this.razorpay_.orders.edit(razorpayOrder.id, {
                notes: {
                    ...((razorpayOrder.notes as Record<string, string>) ||
                        {}),
                    medusa_payment_session_id: paymentSessionId,
                },
            })
        }

        return { data: input.data ?? {} }
    }

    async getWebhookActionAndData(
        data: ProviderWebhookPayload["payload"]
    ): Promise<WebhookActionResult> {
        const rawBody = data?.rawData as string
        const signature = data?.headers?.[
            "x-razorpay-signature"
        ] as string

        if (!rawBody || !signature) {
            return { action: PaymentActions.NOT_SUPPORTED }
        }

        const isValid = Razorpay.validateWebhookSignature(
            rawBody,
            signature,
            this.options_.webhook_secret
        )

        if (!isValid) {
            return { action: PaymentActions.NOT_SUPPORTED }
        }

        try {
            const event = JSON.parse(rawBody)
            const payment = event.payload?.payment?.entity

            if (!payment?.order_id) {
                return { action: PaymentActions.NOT_SUPPORTED }
            }

            switch (event.event) {
                case "payment.captured":
                    return {
                        action: PaymentActions.SUCCESSFUL,
                        data: {
                            session_id:
                                payment.notes
                                    ?.medusa_payment_session_id,
                            amount: payment.amount,
                        },
                    }
                case "payment.authorized":
                    return {
                        action: PaymentActions.AUTHORIZED,
                        data: {
                            session_id:
                                payment.notes
                                    ?.medusa_payment_session_id,
                            amount: payment.amount,
                        },
                    }
                case "payment.failed":
                    return {
                        action: PaymentActions.FAILED,
                        data: {
                            session_id:
                                payment.notes
                                    ?.medusa_payment_session_id,
                            amount: payment.amount,
                        },
                    }
                default:
                    return {
                        action: PaymentActions.NOT_SUPPORTED,
                    }
            }
        } catch (error) {
            this.logger_?.error(`Webhook processing error: ${error}`)
            return { action: PaymentActions.NOT_SUPPORTED }
        }
    }

    async createAccountHolder(
        input: CreateAccountHolderInput
    ): Promise<CreateAccountHolderOutput> {
        const customer = input.context?.customer as PaymentCustomerDTO

        if (!customer) {
            return { id: "", data: {} }
        }

        try {
            const razorpayCustomer =
                await this.razorpay_.customers.create({
                    name:
                        `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim() ||
                        customer.email,
                    email: customer.email,
                    contact:
                        (customer as any).phone ??
                        (customer as any).billing_address?.phone ??
                        undefined,
                    notes: {
                        medusa_customer_id: customer.id,
                    },
                })

            await this.updateRazorpayMetadataInCustomer(
                customer as any,
                "razorpay_id",
                razorpayCustomer.id
            )

            return { id: razorpayCustomer.id, data: { razorpayCustomer } }
        } catch (error) {
            this.logger_?.error(
                `Failed to create Razorpay customer: ${error}`
            )
            return { id: "", data: {} }
        }
    }

    async updateAccountHolder(
        input: UpdateAccountHolderInput
    ): Promise<UpdateAccountHolderOutput> {
        const customer = input.context?.customer as PaymentCustomerDTO
        const accountHolderData = input.context?.account_holder
            ?.data as Record<string, any> | undefined
        const razorpayCustomerId =
            accountHolderData?.razorpayCustomer?.id as string | undefined

        if (!customer || !razorpayCustomerId) {
            return { data: {} }
        }

        try {
            const razorpayCustomer =
                await this.razorpay_.customers.edit(razorpayCustomerId, {
                    name:
                        `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim() ||
                        customer.email,
                    email: customer.email,
                    contact:
                        (customer as any).phone ??
                        (customer as any).billing_address?.phone ??
                        undefined,
                })

            return {
                data: { razorpayCustomer },
            }
        } catch (error) {
            this.logger_?.error(
                `Failed to update Razorpay customer: ${error}`
            )
            return { data: {} }
        }
    }

    async deleteAccountHolder(
        input: DeleteAccountHolderInput
    ): Promise<DeleteAccountHolderOutput> {
        const accountHolderData = input.context?.account_holder
            ?.data as Record<string, any> | undefined
        const razorpayCustomerId =
            accountHolderData?.razorpayCustomer?.id as string | undefined

        if (!razorpayCustomerId) {
            return { data: {} }
        }

        try {
            await this.razorpay_.customers.edit(razorpayCustomerId, {
                name: "DELETED",
            })
        } catch (error) {
            this.logger_?.warn(
                `Failed to mark Razorpay customer as deleted: ${error}`
            )
        }

        return { data: {} }
    }

    private async updateRazorpayMetadataInCustomer(
        customer: { id: string },
        parameterName: string,
        parameterValue: string
    ): Promise<void> {
        await updateRazorpayCustomerMetadataWorkflow(
            (this as any).__container__ ?? this.container
        ).run({
            input: {
                medusa_customer_id: customer.id,
                [parameterName]: parameterValue,
            },
        })
    }
}
