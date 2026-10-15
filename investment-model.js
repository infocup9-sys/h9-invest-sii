const allocationSets = {
  sixMonths: [
    ['Gold', 'Commodities', 14], ['Oil', 'Commodities', 9], ['Electricity', 'Energy', 12],
    ['S&P 500', 'US equities', 19], ['NASDAQ', 'Technology equities', 14], ['Tesla', 'Individual stocks', 8],
    ['Artificial intelligence', 'Technology', 12], ['Bitcoin', 'Crypto', 7], ['Ethereum', 'Crypto', 5],
  ],
  oneYear: [
    ['Gold', 'Commodities', 10], ['Oil', 'Commodities', 9], ['Electricity', 'Energy', 10],
    ['S&P 500', 'US equities', 18], ['NASDAQ', 'Technology equities', 16], ['Tesla', 'Individual stocks', 10],
    ['Artificial intelligence', 'Technology', 15], ['Bitcoin', 'Crypto', 7], ['Ethereum', 'Crypto', 5],
  ],
  longTerm: [
    ['Gold', 'Commodities', 8], ['Oil', 'Commodities', 8], ['Electricity', 'Energy', 8],
    ['S&P 500', 'US equities', 17], ['NASDAQ', 'Technology equities', 18], ['Tesla', 'Individual stocks', 10],
    ['Artificial intelligence', 'Technology', 17], ['Bitcoin', 'Crypto', 8], ['Ethereum', 'Crypto', 6],
  ],
};

export const PLANS = [6, 12, 24, 36, 60].map((months) => ({
  id: 'plan-' + months + 'm',
  name: months === 6 ? '6-month plan' : (months / 12) + '-year plan',
  months,
  allocations: allocationSets[months === 6 ? 'sixMonths' : months === 12 ? 'oneYear' : 'longTerm']
    .map(([name, category, weight]) => ({ name, category, weight })),
}));

export const CUSTOM_ASSETS = [...new Map(PLANS.flatMap((plan) => plan.allocations)
  .map((asset) => [asset.name, asset])).values()];

export function contractMaturityAt(startedAt, months) {
  const start = new Date(startedAt);
  const targetMonth = start.getMonth() + months;
  const year = start.getFullYear() + Math.floor(targetMonth / 12);
  const month = targetMonth % 12;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(
    year, month, Math.min(start.getDate(), lastDay),
    start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds(),
  ).getTime();
}

export function calendarDaysBetween(startedAt, endedAt) {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endDay - startDay) / 86_400_000);
}
