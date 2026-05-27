import { BigNumberInput } from "@medusajs/framework/types"
import { BigNumber, MathBN } from "@medusajs/framework/utils"

const ZERO_DECIMAL_CURRENCIES = [
    "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
    "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]

const THREE_DECIMAL_CURRENCIES = [
    "bhd", "jod", "kwd", "omr", "tnd",
]

function getCurrencyMultiplier(currency: string): number {
    const code = currency.toLowerCase()
    if (ZERO_DECIMAL_CURRENCIES.includes(code)) {
        return 1
    }
    if (THREE_DECIMAL_CURRENCIES.includes(code)) {
        return 1000
    }
    return 100
}

export function getAmountFromSmallestUnit(
    amount: BigNumberInput,
    currency: string
): number {
    const multiplier = getCurrencyMultiplier(currency)
    return MathBN.div(amount, multiplier).toNumber()
}

export function getSmallestUnit(
    amount: BigNumberInput,
    currency: string
): number {
    const multiplier = getCurrencyMultiplier(currency)
    return MathBN.mult(amount, multiplier).toNumber()
}
