import {
    createStep,
    createWorkflow,
    StepResponse,
    WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { ICustomerModuleService } from "@medusajs/framework/types"

export type UpdateRazorpayCustomerMetadataInput = {
    medusa_customer_id: string
} & Record<string, unknown>

const updateCustomerStep = createStep(
    "update-razorpay-customer-metadata",
    async (
        input: UpdateRazorpayCustomerMetadataInput,
        { container }
    ): Promise<StepResponse<Record<string, unknown>, string>> => {
        const customerService: ICustomerModuleService = container.resolve(
            Modules.CUSTOMER
        )

        const { medusa_customer_id, ...razorpayData } = input

        const customer = await customerService.retrieveCustomer(
            medusa_customer_id
        )

        const existingMetadata =
            (customer.metadata as Record<string, unknown>) ?? {}
        const existingRazorpay =
            (existingMetadata.razorpay as Record<string, unknown>) ?? {}

        await customerService.updateCustomers(medusa_customer_id, {
            metadata: {
                ...existingMetadata,
                razorpay: {
                    ...existingRazorpay,
                    ...razorpayData,
                },
            },
        })

        return new StepResponse(
            {
                customerId: customer.id,
                updatedFields: Object.keys(razorpayData),
            },
            customer.id
        )
    }
)

export const updateRazorpayCustomerMetadataWorkflow = createWorkflow(
    "update-razorpay-customer-metadata",
    (input: UpdateRazorpayCustomerMetadataInput) => {
        const result = updateCustomerStep(input)
        return new WorkflowResponse(result)
    }
)
