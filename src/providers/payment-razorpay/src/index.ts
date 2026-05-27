import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { RazorpayProviderService } from "./services/razorpay-provider"

export default ModuleProvider(Modules.PAYMENT, {
    services: [RazorpayProviderService],
})
