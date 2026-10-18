// Pricing for minimax/h3-max/reference-director.
// fal bills `FAL_PRICE_PER_SECOND_USD` per billable unit, and each streamed second
// costs a resolution-dependent number of units (from the model's `session_info`).

export const MODEL_ID = "minimax/h3-max/reference-director";

export const RESOLUTIONS = ["480p", "544p", "640p", "704p", "768p", "1080p", "1440p"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

const BILLABLE_UNITS_PER_SECOND: Record<Resolution, number> = {
  "480p": 1,
  "544p": 1.04,
  "640p": 1.1,
  "704p": 1.15,
  "768p": 1.2,
  "1080p": 1.2,
  "1440p": 1.2,
};

export const MC_PER_USD = 100_000;

// How often the fal client heartbeats; each heartbeat is a billing tick.
export const HEARTBEAT_SECONDS = 5;

const falPricePerSecondUsd = Number(process.env.FAL_PRICE_PER_SECOND_USD ?? "0.05");
export const markupPercent = Number(process.env.MARKUP_PERCENT ?? "30");
const minStartSeconds = Number(process.env.MIN_START_SECONDS ?? "30");

export function isResolution(value: unknown): value is Resolution {
  return typeof value === "string" && (RESOLUTIONS as readonly string[]).includes(value);
}

export function falCostPerSecondMc(resolution: Resolution): number {
  return falPricePerSecondUsd * BILLABLE_UNITS_PER_SECOND[resolution] * MC_PER_USD;
}

export function pricePerSecondMc(resolution: Resolution): number {
  return falCostPerSecondMc(resolution) * (1 + markupPercent / 100);
}

export function minStartBalanceMc(resolution: Resolution): number {
  return Math.ceil(pricePerSecondMc(resolution) * minStartSeconds);
}

export function usdToMc(usd: number): number {
  return Math.round(usd * MC_PER_USD);
}

export function formatUsd(mc: number): string {
  return `$${(mc / MC_PER_USD).toFixed(2)}`;
}

export function priceTable() {
  return RESOLUTIONS.map((resolution) => ({
    resolution,
    perSecondMc: pricePerSecondMc(resolution),
    perMinuteUsd: (pricePerSecondMc(resolution) * 60) / MC_PER_USD,
  }));
}
