export type Cents = number & { readonly __brand: "Cents" };

export function isCents(value: number): value is Cents {
  return Number.isSafeInteger(value) && value >= 0;
}

export function cents(value: number): Cents {
  if (!isCents(value)) throw new RangeError(`not a non-negative integer cent amount: ${value}`);
  return value;
}

export function addCents(a: Cents, b: Cents): Cents {
  return cents(a + b);
}

export function subCents(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

/**
 * Scales a non-negative decimal by 10^decimals and rounds half-up, exactly.
 * Works from the number's shortest round-trip string, so 1.005 scales to 101
 * at 2 decimals where Math.round(1.005 * 100) gives 100.
 */
export function toScaledInt(value: number, decimals: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`expected a non-negative finite number, got ${value}`);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(value.toString());
  if (!match) throw new RangeError(`unparseable number: ${value}`);
  const [, whole = "0", frac = "", exp = "0"] = match;
  const mantissa = BigInt(whole + frac);
  const shift = Number(exp) - frac.length + decimals;
  const scaled = shift >= 0 ? mantissa * 10n ** BigInt(shift) : divHalfUp(mantissa, 10n ** BigInt(-shift));
  const result = Number(scaled);
  if (!Number.isSafeInteger(result)) throw new RangeError(`number too large: ${value}`);
  return result;
}

export function dollarsToCents(dollars: number): Cents {
  return cents(toScaledInt(dollars, 2));
}

export function centsToDollars(amount: Cents): number {
  return amount / 100;
}

/** Percent with up to two decimals, as hundredths of a percent: 8.25% is 825. */
export function percentToBasisPoints(percent: number): number {
  return toScaledInt(percent, 2);
}

/** round_half_up(a * b / d) for non-negative integers, without float error. */
export function mulDivHalfUp(a: number, b: number, d: number): number {
  const result = Number(divHalfUp(BigInt(a) * BigInt(b), BigInt(d)));
  if (!Number.isSafeInteger(result)) throw new RangeError("amount too large");
  return result;
}

function divHalfUp(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUSD(amount: Cents): string {
  return usd.format(amount / 100);
}
