export const REWARDS = [
  { id: 'boost-1h', type: 'boost', hours: 1, points: 36000, title: 'Double earnings · 1 hour' },
  { id: 'boost-10h', type: 'boost', hours: 10, points: 300000, title: 'Double earnings · 10 hours' },
  { id: 'boost-24h', type: 'boost', hours: 24, points: 640000, title: 'Double earnings · 24 hours' },
  { id: 'cash-2', type: 'coupon', amount: 2, points: 160000, title: '2 USDT coupon' },
  { id: 'cash-10', type: 'coupon', amount: 10, points: 800000, title: '10 USDT coupon' },
  { id: 'cash-50', type: 'coupon', amount: 50, points: 4000000, title: '50 USDT coupon' },
];

const TICKET_POOL = 100_000_000;

export const DAILY_PRIZES = [
  { id: 'points-10', points: 10, tickets: 49_700_000 },
  { id: 'points-30', points: 30, tickets: 30_000_000 },
  { id: 'points-50', points: 50, tickets: 15_000_000 },
  { id: 'points-100', points: 100, tickets: 4_000_000 },
  { id: 'points-250', points: 250, tickets: 900_000 },
  { id: 'points-500', points: 500, tickets: 100_000 },
  { id: 'points-750', points: 750, tickets: 150_000 },
  { id: 'points-1000', points: 1000, tickets: 100_000 },
  { id: 'points-2500', points: 2500, tickets: 50_000 },
];

export const DAILY_TICKET_POOL = TICKET_POOL;

export function chooseDailyPrize(ticket) {
  let edge = 0;
  for (const prize of DAILY_PRIZES) {
    edge += prize.tickets;
    if (ticket < edge) return prize;
  }
  return DAILY_PRIZES[0];
}
