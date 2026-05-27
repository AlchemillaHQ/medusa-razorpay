# @alchemilla/medusa-razorpay

Razorpay payment provider for [Medusa v2](https://medusajs.com). A standalone module that enables Razorpay payments with webhook handling, proper currency conversion, customer management, and admin dashboard widgets.

## Installation

```bash
npm install @alchemilla/medusa-razorpay
# or
yarn add @alchemilla/medusa-razorpay
# or
pnpm add @alchemilla/medusa-razorpay
```

## Backend Configuration

### 1. Environment Variables

Add to your Medusa backend `.env` file:

```env
RAZORPAY_ID=rzp_test_xxx               # Razorpay API key ID
RAZORPAY_SECRET=yyy                     # Razorpay API key secret
RAZORPAY_ACCOUNT=acc_xxx                # Razorpay account/merchant ID
RAZORPAY_WEBHOOK_SECRET=whsec_zzz       # From Razorpay dashboard > Settings > Webhooks
```

### 2. medusa-config.ts

Register the provider in your Medusa config:

```ts
import { defineConfig } from "@medusajs/framework/utils"

module.exports = defineConfig({
  // ...
  modules: [
    // ... other modules
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@alchemilla/medusa-razorpay/providers/payment-razorpay/src",
            id: "razorpay",
            options: {
              key_id: process.env.RAZORPAY_ID || "",
              key_secret: process.env.RAZORPAY_SECRET || "",
              razorpay_account: process.env.RAZORPAY_ACCOUNT || "",
              webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
              manual_expiry_period: 20,        // minutes (required if auto_capture is off)
              refund_speed: "normal",           // "normal" | "optimum"
              auto_capture: false,              // Set true for automatic payment capture
            },
          },
        ],
      },
    },
  ],
})
```

> **Important notes on options:**
> - `refund_speed` is used at refund time only — it is **not** sent in the order creation body (Razorpay rejects it there).
> - Either `manual_expiry_period` or `automatic_expiry_period` is required.
> - `auto_capture: true` requires `automatic_expiry_period` instead of `manual_expiry_period`.

### 3. Webhook Setup

In your Razorpay dashboard, create a webhook with the URL:

```
https://your-domain.com/hooks/payment/razorpay_razorpay
```

Select these events:
- `payment.authorized`
- `payment.captured`
- `payment.failed`

## Storefront Integration

### 1. Install `react-razorpay`

```bash
npm install react-razorpay
```

### 2. Environment Variables

Add to your storefront `.env.local`:

```env
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxx    # Same as RAZORPAY_ID / key_id above
NEXT_PUBLIC_SHOP_NAME=Your Store Name
NEXT_PUBLIC_MEDUSA_BACKEND_URL=https://your-backend.com   # Must be publicly reachable for callbacks
```

> `NEXT_PUBLIC_MEDUSA_BACKEND_URL` must be a publicly reachable URL (or tunneled via ngrok/localtunnel) so Razorpay can POST the payment response to the callback endpoint.

### 3. Backend: Storefront URL

Add to your backend `.env` so the callback redirect knows where to send the user:

```env
STOREFRONT_URL=http://localhost:8000
```

### 4. Constants

In `src/lib/constants.tsx`, add:

```tsx
// Add to paymentInfoMap
pp_razorpay_razorpay: {
  title: "Razorpay",
  icon: <CreditCard />,
},

// Add the helper
export const isRazorpay = (providerId?: string) => {
  return providerId?.startsWith("pp_razorpay")
}
```

### 5. Razorpay Payment Button

Create `src/modules/checkout/components/payment-button/razorpay-payment-button.tsx`:

```tsx
"use client"

import { placeOrder } from "@lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@modules/common/components/ui"
import { useRazorpay, RazorpayOrderOptions } from "react-razorpay"
import React, { useCallback, useState } from "react"
import ErrorMessage from "../error-message"

type RazorpayPaymentButtonProps = {
  cart: HttpTypes.StoreCart
  notReady: boolean
  "data-testid"?: string
}

const RazorpayPaymentButton: React.FC<RazorpayPaymentButtonProps> = ({
  cart,
  notReady,
  "data-testid": dataTestId,
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { error, isLoading, Razorpay } = useRazorpay()

  const session = cart.payment_collection?.payment_sessions?.find(
    (s) => s.status === "pending" || s.status === "requires_more"
  )

  const razorpayOrder = session?.data?.razorpayOrder as Record<string, any> | undefined

  const handlePayment = useCallback(async () => {
    if (!razorpayOrder?.id || !session) return
    setSubmitting(true)

    // Place the order first, then open payment modal.
    // On payment success, Razorpay redirects to the callback URL
    // which verifies the signature and redirects back to the storefront.
    try {
      await placeOrder()
    } catch (err) {
      setErrorMessage((err as Error).message)
      setSubmitting(false)
      return
    }

    const options: RazorpayOrderOptions = {
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "",
      amount: Math.round(session.amount * 100),
      currency: (cart.currency_code?.toUpperCase() || "EUR") as any,
      name: process.env.NEXT_PUBLIC_SHOP_NAME || "Your Store",
      description: `Order ${razorpayOrder.id}`,
      order_id: razorpayOrder.id,
      callback_url: `${process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL}/razorpay/callback`,
      redirect: true,
      prefill: {
        name: `${cart.billing_address?.first_name ?? ""} ${cart.billing_address?.last_name ?? ""}`.trim() || cart.email || "",
        email: cart.email ?? "",
        contact: cart.shipping_address?.phone ?? cart.billing_address?.phone ?? undefined,
        method: (cart.currency_code === "inr") ? "upi" as any : undefined,
      },
      modal: {
        ondismiss: () => { setSubmitting(false); setErrorMessage("Payment cancelled") },
        escape: true,
        animation: true,
      },
    }

    const rzp = new Razorpay(options)
    rzp.on("payment.failed", (response: any) => {
      setErrorMessage(response.error?.description || "Payment failed")
      setSubmitting(false)
    })
    rzp.open()
  }, [Razorpay, razorpayOrder, session, cart])

  if (isLoading) return <Button disabled isLoading>Loading...</Button>
  if (error) return <Button disabled>Razorpay unavailable</Button>

  return (
    <>
      <Button
        disabled={notReady || submitting || !razorpayOrder?.id}
        onClick={handlePayment}
        size="large"
        isLoading={submitting}
        data-testid={dataTestId}
      >
        Pay with Razorpay
      </Button>
      <ErrorMessage error={errorMessage} data-testid="razorpay-payment-error-message" />
    </>
  )
}

export default RazorpayPaymentButton
```

### 6. Wire into PaymentButton

In `src/modules/checkout/components/payment-button/index.tsx`:

```tsx
import { isManual, isRazorpay, isStripeLike } from "@lib/constants"
import RazorpayPaymentButton from "./razorpay-payment-button"

// Inside the PaymentButton component's switch:
case isRazorpay(paymentSession?.provider_id):
  return (
    <RazorpayPaymentButton
      notReady={notReady}
      cart={cart}
      data-testid={dataTestId}
    />
  )
```

## API Routes (included)

The package includes a callback endpoint for Razorpay payment verification:

```
POST /razorpay/callback
```

When the customer completes payment in the Razorpay modal, Razorpay redirects the browser to this endpoint with the payment signature. The endpoint:

1. Receives `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`
2. Verifies the signature using HMAC-SHA256 with your `key_secret`
3. Redirects the browser back to the storefront order confirmation page

## Checkout Flow

1. Customer adds items to cart
2. At checkout, selects **Razorpay** as payment method
3. On "Continue to review", a Razorpay order is created via backend
4. On "Pay with Razorpay", `placeOrder()` is called first to finalize the order
5. The Razorpay modal opens for payment
6. Customer completes payment in the Razorpay modal
7. Razorpay redirects to `POST /razorpay/callback` on your backend
8. Backend verifies the payment signature and redirects to the order confirmation page
9. Razorpay also sends a webhook to `/hooks/payment/razorpay_razorpay` to update payment status

> **Why `callback_url` + webhooks?** Two mechanisms for reliability: the callback confirms payment to the customer immediately via browser redirect; webhooks update payment status server-to-server even if the redirect fails.
>
> **Why `placeOrder()` before the modal?** Creates the order first so it exists regardless of what happens in the Razorpay modal. The webhook can then update its payment status independently.

### Local Development

For webhooks and callbacks to reach your local backend, expose it with a tunnel:

```bash
# Using localtunnel
npx localtunnel --port 9000 --subdomain your-subdomain

# Using ngrok
ngrok http 9000
```

Then set `NEXT_PUBLIC_MEDUSA_BACKEND_URL` in your storefront to the tunnel URL and configure the webhook URL in Razorpay dashboard accordingly.

### License

Built upon inspiration from the [Payment-Razorpay](https://medusajs.com/integrations/@sgftechpayment-razorpay/) provider by [SGFGOV](https://github.com/SGFGOV/medusa-payment-plugins).