import { Pesewas } from '../../../common/money/money';

export function outstandingBalance(price: Pesewas, deposit: Pesewas, totalPaidOnInstallments: Pesewas): Pesewas {
  return Math.max(0, price - deposit - totalPaidOnInstallments);
}

/** Payback weeks = price / average weekly net to owner. Returns null when there is no income to project from. */
export function paybackWeeks(price: Pesewas, averageWeeklyNetToOwner: Pesewas): number | null {
  if (averageWeeklyNetToOwner <= 0) return null;
  return Math.round((price / averageWeeklyNetToOwner) * 10) / 10;
}

/** Share of amount due that was actually collected, as a percentage with one decimal. 100 when nothing was due. */
export function collectionRate(collected: Pesewas, due: Pesewas): number {
  if (due <= 0) return 100;
  return Math.round((Math.min(collected, due) / due) * 1000) / 10;
}
