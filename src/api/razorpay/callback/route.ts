import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createHmac } from "crypto"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    const logger = req.scope.resolve("logger") ?? console
    const {
        razorpay_payment_id,
        razorpay_order_id,
        razorpay_signature,
    } = req.body as Record<string, string>

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
        logger.warn("Razorpay callback: missing payment details")
        return res.status(400).json({ error: "Missing payment details" })
    }

    try {
        const paymentService = req.scope.resolve(
            "paymentProviderService"
        ) as any
        const provider = paymentService.retrieveProvider("pp_razorpay_razorpay")
        const secret = provider.options_?.key_secret ?? provider.config?.key_secret ?? ""

        const generated = createHmac("sha256", secret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest("hex")

        if (generated !== razorpay_signature) {
            logger.warn("Razorpay callback: signature mismatch")
            return res.status(400).json({ error: "Invalid signature" })
        }

        const storefrontUrl =
            process.env.STOREFRONT_URL ||
            process.env.STORE_CORS?.split(",")?.[0]?.trim() ||
            "http://localhost:8000"

        return res.redirect(
            302,
            `${storefrontUrl}/order/confirmed?payment_id=${razorpay_payment_id}&order_id=${razorpay_order_id}`
        )
    } catch (err: any) {
        logger.error(`Razorpay callback error: ${err.message}`)
        return res.status(500).json({ error: "Internal error" })
    }
}

export const GET = POST
