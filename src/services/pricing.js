import DEFAULT_PRICING from '../../assets/default-pricing.json';
import { getSettings } from './storage';

/**
 * Returns the full pricing block for the user's trade, merging any
 * per-part overrides from settings on top of the default list.
 * Also injects labour_hourly, callout_fee, and vat_rate from settings.
 */
export async function getPricingForCurrentTrade() {
  const settings = await getSettings();
  const trade = settings.trade || 'plumber';
  const base = DEFAULT_PRICING[trade] || DEFAULT_PRICING.plumber;

  return {
    trade,
    labour_hourly: settings.labourHourly ?? base.labour_hourly,
    callout_fee: settings.calloutFee ?? base.callout_fee,
    vat_rate: settings.vatRegistered ? (settings.vatRate ?? 0.20) : 0,
    parts: base.parts, // MVP: no per-part user overrides yet
  };
}

export const TRADES = [
  { key: 'plumber',     label: 'Plumber'     },
  { key: 'electrician', label: 'Electrician' },
  { key: 'hvac',        label: 'HVAC / Heating' },
  { key: 'roofer',      label: 'Roofer'      },
  { key: 'handyman',    label: 'Handyman'    },
];

export function getDefaultRatesForTrade(trade) {
  const base = DEFAULT_PRICING[trade] || DEFAULT_PRICING.plumber;
  return {
    labourHourly: base.labour_hourly,
    calloutFee: base.callout_fee,
  };
}
