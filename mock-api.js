import { PLANS, CUSTOM_ASSETS, contractMaturityAt, calendarDaysBetween } from './investment-model.js';
import { chooseDailyPrize, DAILY_TICKET_POOL, REWARDS } from './rewards-model.js';

const MOCK_ACCOUNTS_KEY = 'h9-mock-backend-v1';
const MOCK_SESSIONS_KEY = 'h9-mock-sessions-v1';
const DEPOSIT_ADDRESSES_KEY = 'h9-platform-deposit-addresses-v1';
const LEGACY_ACCOUNTS_KEY = 'h9-test-accounts-v1';
const PASSWORD_RESET_TOKENS_KEY = 'h9-password-reset-tokens-v1';
const DAY_MS = 86_400_000;
const NETWORKS = ['bep20', 'bitcoin', 'trc20'];
const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fail = (message) => { throw new Error(message); };

async function passwordDigest(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: new TextEncoder().encode(salt),
    iterations: 120_000,
    hash: 'SHA-256',
  }, material, 256);
  return [...new Uint8Array(bits)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

function readAccounts() {
  let accounts = [];
  try {
    const saved = JSON.parse(localStorage.getItem(MOCK_ACCOUNTS_KEY) || '[]');
    if (Array.isArray(saved)) accounts = saved;
  } catch {}
  accounts = accounts.filter((account) => account && typeof account.email === 'string' && account.username);
  let changed = false;
  accounts.forEach((account, index) => {
    if (!account.id) { account.id = makeId(); changed = true; }
    account.role ||= index === 0 ? 'admin' : 'user';
    account.status ||= 'approved';
    account.wallet ||= { deposit: 0, earnings: 0 };
    account.investments ||= [];
    account.transactions ||= [];
    account.depositRequests ||= [];
    account.withdrawalRequests ||= [];
    account.preferences ||= { language: 'en', theme: 'dark' };
    if (account.languageDefaultVersion !== 1) {
      if (account.preferences.language === 'it') account.preferences.language = 'en';
      account.languageDefaultVersion = 1;
      changed = true;
    }
    account.withdrawalWallet ??= null;
    account.walletChangeRequests ||= [];
    account.h9Points = Math.max(0, Math.floor(Number(account.h9Points) || 0));
    account.bonusSpins = Math.max(0, Math.floor(Number(account.bonusSpins) || 0));
    account.pointHistory ||= [];
    account.referrals ||= [];
    account.activeBonuses ||= [];
    account.rewardRedemptions ||= [];
    account.dailyPrizes ||= [];
    let legacyEarnings = Math.max(0, Number(account.wallet.earnings) || 0);
    for (const investment of [...(account.investments || [])].sort((a, b) => a.startedAt - b.startedAt)) {
      investment.earningsCredited = Math.max(0, Number(investment.earningsCredited) || 0);
      if (investment.compoundBalance === undefined && investment.uncompoundedEarnings === undefined) {
        const migratedBalance = Math.min(legacyEarnings, investment.earningsCredited);
        investment.compoundBalance = migratedBalance;
        investment.uncompoundedEarnings = 0;
        legacyEarnings -= migratedBalance;
        changed = true;
      } else {
        investment.compoundBalance = Math.max(0, Number(investment.compoundBalance) || 0);
        investment.uncompoundedEarnings = Math.max(0, Number(investment.uncompoundedEarnings) || 0);
      }
      if (investment.dailyCreditVersion !== 2) {
        if (investment.status === 'active' && investment.uncompoundedEarnings > 0) {
          investment.compoundBalance += investment.uncompoundedEarnings;
          investment.uncompoundedEarnings = 0;
        }
        investment.dailyCreditVersion = 2;
        changed = true;
      }
    }
    if (account.earningsCompoundingVersion !== 3) {
      const reinvested = account.investments.reduce(
        (sum, investment) => sum + (Number(investment.compoundBalance) || 0),
        0,
      );
      account.wallet.earnings = Math.max(
        0,
        (Number(account.wallet.earnings) || 0) - reinvested,
      );
      account.earningsCompoundingVersion = 3;
      changed = true;
    }
    if (!account.referralCode) {
      account.referralCode = makeReferralCode(accounts, account.id);
      changed = true;
    }
    account.revision ||= 1;
    account.createdAt ||= Date.now();
  });

  let migrateLegacyAccounts = false;
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_ACCOUNTS_KEY) || '[]');
    if (Array.isArray(legacy)) {
      migrateLegacyAccounts = true;
      for (const old of legacy) {
        if (!old?.email || !old?.username ||
            accounts.some((account) => account.email.toLowerCase() === old.email.toLowerCase())) continue;
        accounts.push({
          ...old,
          id: old.id || makeId(),
          role: old.role || (accounts.length === 0 ? 'admin' : 'user'),
          status: old.status || 'approved',
          wallet: old.wallet || { deposit: 0, earnings: 0 },
          investments: Array.isArray(old.investments) ? old.investments : [],
          transactions: Array.isArray(old.transactions) ? old.transactions : [],
          depositRequests: Array.isArray(old.depositRequests) ? old.depositRequests : [],
          withdrawalRequests: Array.isArray(old.withdrawalRequests) ? old.withdrawalRequests : [],
          preferences: old.preferences || { language: 'en', theme: 'dark' },
          withdrawalWallet: old.withdrawalWallet || null,
          walletChangeRequests: Array.isArray(old.walletChangeRequests) ? old.walletChangeRequests : [],
          h9Points: old.h9Points || 0,
          bonusSpins: old.bonusSpins || 0,
          pointHistory: Array.isArray(old.pointHistory) ? old.pointHistory : [],
          referrals: Array.isArray(old.referrals) ? old.referrals : [],
          activeBonuses: Array.isArray(old.activeBonuses) ? old.activeBonuses : [],
          rewardRedemptions: Array.isArray(old.rewardRedemptions) ? old.rewardRedemptions : [],
          dailyPrizes: Array.isArray(old.dailyPrizes) ? old.dailyPrizes : [],
          referralCode: old.referralCode || makeReferralCode(accounts, old.id),
          revision: 1,
          createdAt: old.createdAt || Date.now(),
        });
        changed = true;
      }
    }
  } catch {}
  if (changed || !localStorage.getItem(MOCK_ACCOUNTS_KEY)) saveAccounts(accounts);
  if (migrateLegacyAccounts) localStorage.removeItem(LEGACY_ACCOUNTS_KEY);
  return accounts;
}

function makeReferralCode(accounts, accountId) {
  const base = String(accountId || makeId()).replace(/[^a-z0-9]/gi, '').slice(-7).toUpperCase();
  let code = base;
  while (accounts.some((account) => account.referralCode === code)) {
    code = `${base.slice(-5)}${Math.floor(Math.random() * 90 + 10)}`;
  }
  return code;
}

function saveAccounts(accounts) {
  localStorage.setItem(MOCK_ACCOUNTS_KEY, JSON.stringify(accounts));
}

function makeRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((part) => part.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function readPasswordResetTokens() {
  try {
    const saved = JSON.parse(localStorage.getItem(PASSWORD_RESET_TOKENS_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((item) => item?.tokenHash && item.expiresAt > Date.now()) : [];
  } catch {
    return [];
  }
}

function publicAccount(account) {
  const {
    id, username, email, role, status, createdAt, reviewedAt, revision,
    wallet, investments, transactions, depositRequests, withdrawalRequests,
    preferences, withdrawalWallet, walletChangeRequests, h9Points, pointHistory, referralCode,
    referrals, activeBonuses, rewardRedemptions, dailyPrizes, invitedBy, bonusSpins,
    customPlanSubscription,
  } = account;
  return {
    id, username, email, role, status, createdAt, reviewedAt, revision,
    wallet, investments, transactions, depositRequests, withdrawalRequests,
    preferences, withdrawalWallet, walletChangeRequests,
    withdrawalPinSet: Boolean(account.withdrawalPinHash), h9Points, pointHistory, referralCode,
    referrals, activeBonuses, rewardRedemptions, dailyPrizes, invitedBy, bonusSpins,
    customPlanSubscription: customPlanSubscription || null,
    lastDailyPrizeDate: account.lastDailyPrizeDate || null,
    recoveryKeySet: Boolean(account.recoveryKeyIssuer && account.recoveryKeyHash && account.recoveryKeySalt),
  };
}

function readDepositAddresses() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEPOSIT_ADDRESSES_KEY) || '{}');
    return Object.fromEntries(NETWORKS.map((network) => [network, String(saved[network] || '')]));
  } catch {
    return Object.fromEntries(NETWORKS.map((network) => [network, '']));
  }
}

function pointEntry(account, amount, type, label, extra = {}) {
  const entry = { id: makeId(), amount, type, label, date: Date.now(), ...extra };
  account.pointHistory.unshift(entry);
  return entry;
}

function secureTicket(poolSize) {
  const ceiling = Math.floor(0x1_0000_0000 / poolSize) * poolSize;
  const values = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(values);
    value = values[0];
  } while (value >= ceiling);
  return value % poolSize;
}

function readSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem(MOCK_SESSIONS_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function issueSession(accountId) {
  const token = makeId();
  const sessions = readSessions();
  sessions[token] = accountId;
  localStorage.setItem(MOCK_SESSIONS_KEY, JSON.stringify(sessions));
  return token;
}

function getSessionAccount(accessToken, options) {
  const headers = new Headers(options.headers || {});
  const authorization = headers.get('Authorization') || (accessToken ? `Bearer ${accessToken}` : '');
  const token = authorization.replace(/^Bearer\s+/i, '');
  const accountId = readSessions()[token];
  if (!accountId) return fail('Session expired. Please log in again.');
  const account = readAccounts().find((item) => item.id === accountId);
  if (!account) return fail('Account not found.');
  if (account.status !== 'approved') return fail('This account is not active.');
  return account;
}

function calculateMarketValue(investment, quotes) {
  const basis = investment.marketBasis || [];
  const totalWeight = basis.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  if (!totalWeight) return Number(investment.marketTrackingValue) || investment.principal;
  const prices = investment.lastMarketPrices || {};
  let relativeMove = 0;
  for (const item of basis) {
    const previousPrice = Number(prices[item.name]) || Number(item.price);
    const currentPrice = Number(quotes[item.name]) || previousPrice;
    if (previousPrice > 0 && currentPrice > 0) {
      relativeMove += (Number(item.weight) / totalWeight) * (currentPrice / previousPrice);
      prices[item.name] = currentPrice;
    } else {
      relativeMove += Number(item.weight) / totalWeight;
    }
  }
  investment.lastMarketPrices = prices;
  return Math.max(0, (Number(investment.marketTrackingValue) || investment.principal) * relativeMove);
}

function updateMarketInvestments(account, quotes = {}) {
  let changed = false;
  for (const investment of account.investments || []) {
    if (!investment || investment.status !== 'active') continue;
    const previousRedeemable = Math.max(0, (Number(investment.marketValue) || investment.principal) - investment.principal);
    if (!Number.isFinite(Number(investment.marketTrackingValue))) {
      investment.marketTrackingValue = (Number(investment.marketValue) || investment.principal) +
        (Number(investment.compoundBalance) || 0) + (Number(investment.uncompoundedEarnings) || 0);
    }
    if (!Array.isArray(investment.marketBasis) || !investment.marketBasis.length) {
      const plan = PLANS.find((item) => item.id === investment.planId);
      investment.marketBasis = (investment.allocation?.length ? investment.allocation : plan?.allocations || []).flatMap((item) => {
        const price = Number(quotes[item.name]);
        return price > 0 ? [{ name: item.name, price, weight: item.weight }] : [];
      });
      investment.lastMarketPrices = Object.fromEntries(investment.marketBasis.map((item) => [item.name, item.price]));
      investment.marketValue = Number(investment.marketValue) || investment.principal;
      investment.marketTrackingValue ||= investment.marketValue;
      investment.protectionSuspended = false;
      changed = true;
    }
    investment.marketTrackingValue = calculateMarketValue(investment, quotes);
    const stopLossPercent = Math.min(80, Math.max(1, Number(investment.stopLossPercent) || 20));
    const protectionFloor = investment.principal * (1 - stopLossPercent / 100);
    investment.protectionSuspended = investment.marketTrackingValue <= protectionFloor;
    investment.marketValue = investment.protectionSuspended
      ? protectionFloor
      : investment.marketTrackingValue;
    investment.compoundBalance = Math.max(0, investment.marketValue - investment.principal);
    changed = true;

    if (!investment.protectionSuspended && investment.autoRedeemEnabled === true) {
      const newProfits = Math.max(0, investment.marketValue - investment.principal) - previousRedeemable;
      const percent = Math.min(100, Math.max(1, Number(investment.autoRedeemPercent) || 100));
      const amount = Math.max(0, newProfits) * percent / 100;
      if (amount > 0) {
        investment.marketValue -= amount;
        investment.marketTrackingValue -= amount;
        investment.compoundBalance = Math.max(0, investment.marketValue - investment.principal);
        account.wallet.earnings += amount;
        const planName = investment.planName || PLANS.find((plan) => plan.id === investment.planId)?.name || 'Investment';
        account.transactions.unshift(transaction('earning-redemption', amount, '', 'completed', {
          investmentId: investment.id,
          planName,
          automatic: true,
        }));
      }
    }

    const maturityAt = investment.maturityAt || investment.startedAt + investment.days * DAY_MS;
    investment.maturityAt = maturityAt;
    if (Date.now() >= maturityAt) {
      investment.status = 'matured';
      investment.maturedAt = maturityAt;
      investment.compoundBalance = 0;
      account.wallet.deposit += investment.marketValue;
      account.transactions.unshift({
        id: makeId(), type: 'maturity', amount: investment.marketValue,
        status: 'completed', investmentId: investment.id,
        planName: investment.planName || PLANS.find((plan) => plan.id === investment.planId)?.name || `${investment.days}-day plan`,
        date: maturityAt,
      });
    }
  }
  return changed;
}

function persistAccount(account) {
  const accounts = readAccounts();
  const index = accounts.findIndex((item) => item.id === account.id);
  if (index < 0) return fail('Account not found.');
  account.revision = (accounts[index].revision || 0) + 1;
  accounts[index] = account;
  saveAccounts(accounts);
  return publicAccount(account);
}

function transaction(type, amount, network = '', status = 'completed', extra = {}) {
  return { id: makeId(), type, amount, network, status, date: Date.now(), ...extra };
}

export async function mockApiRequest(path, options = {}, accessToken = '') {
  const method = options.method || 'GET';
  let body = {};
  try {
    if (options.body) body = JSON.parse(options.body);
  } catch {
    return fail('Invalid request.');
  }

  if (path === '/api/auth/register' && method === 'POST') {
    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (username.length < 3 || username.length > 30 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        password.length < 8 || password.length > 200) {
      return fail('Check your username, email and password (at least 8 characters).');
    }
    const accounts = readAccounts();
    if (accounts.some((account) => account.email.toLowerCase() === email ||
        account.username.toLowerCase() === username.toLowerCase())) {
      return fail('Email or username is already in use.');
    }
    const salt = makeId();
    const referralCode = String(body.referralCode || '').trim().toUpperCase();
    const inviter = referralCode
      ? accounts.find((item) => item.referralCode === referralCode && item.id !== body.id)
      : null;
    const account = {
      id: makeId(),
      username,
      email,
      salt,
      passwordHash: await passwordDigest(password, salt),
      role: accounts.length === 0 ? 'admin' : 'user',
      status: 'approved',
      wallet: { deposit: 0, earnings: 0 },
      investments: [],
      transactions: [],
      depositRequests: [],
      withdrawalRequests: [],
      preferences: { language: ['en', 'fr', 'es', 'de', 'pt', 'hi', 'zh', 'it'].includes(body.language) ? body.language : 'en', theme: 'dark' },
      languageDefaultVersion: 1,
      earningsCompoundingVersion: 3,
      withdrawalWallet: null,
      walletChangeRequests: [],
      h9Points: inviter ? 25 : 0,
      bonusSpins: 0,
      pointHistory: [],
      referralCode: makeReferralCode(accounts),
      referrals: [],
      activeBonuses: [],
      rewardRedemptions: [],
      dailyPrizes: [],
      invitedBy: inviter?.id || null,
      createdAt: Date.now(),
      revision: 1,
    };
    if (inviter) {
      pointEntry(account, 25, 'referral-welcome', 'Welcome points');
      inviter.h9Points = (inviter.h9Points || 0) + 10;
      pointEntry(inviter, 10, 'referral', `Invitation accepted · ${username}`, {
        referredAccountId: account.id,
      });
      inviter.referrals ||= [];
      inviter.referrals.unshift({
        id: account.id, username, date: Date.now(), points: 10,
      });
    }
    accounts.push(account);
    saveAccounts(accounts);
    return { token: issueSession(account.id), account: publicAccount(account) };
  }

  if (path === '/api/admin/recovery-key' && method === 'POST') {
    const admin = getSessionAccount(accessToken, options);
    if (admin.role !== 'admin') return fail('Not authorized.');
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid account email.');
    const account = readAccounts().find((item) => item.email.toLowerCase() === email);
    if (!account) return fail('No registered account was found for this email in this browser.');
    const recoveryCode = makeRecoveryCode();
    account.recoveryKeySalt = makeId();
    account.recoveryKeyHash = await passwordDigest(recoveryCode, account.recoveryKeySalt);
    account.recoveryKeyIssuer = admin.id;
    const result = persistAccount(account);
    const tokens = readPasswordResetTokens().filter((item) => item.accountId !== account.id);
    localStorage.setItem(PASSWORD_RESET_TOKENS_KEY, JSON.stringify(tokens));
    return { account: result, recoveryCode };
  }

  if (path === '/api/auth/password-reset/request' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const recoveryCode = String(body.recoveryCode || '').replace(/\s/g, '').toUpperCase();
    const account = readAccounts().find((item) => item.email.toLowerCase() === email);
    if (!account?.recoveryKeyIssuer || !account.recoveryKeyHash || !account.recoveryKeySalt ||
        await passwordDigest(recoveryCode, account.recoveryKeySalt) !== account.recoveryKeyHash) {
      return fail('Email or recovery key is incorrect. Request an admin-issued key from support.');
    }
    const token = makeId();
    const tokenSalt = makeId();
    const tokens = readPasswordResetTokens();
    tokens.push({
      tokenHash: await passwordDigest(token, tokenSalt), tokenSalt,
      accountId: account.id, expiresAt: Date.now() + 15 * 60_000,
    });
    localStorage.setItem(PASSWORD_RESET_TOKENS_KEY, JSON.stringify(tokens));
    return { token };
  }

  if (path === '/api/auth/password-reset/confirm' && method === 'POST') {
    const token = String(body.token || '');
    const password = String(body.password || '');
    if (password.length < 8 || password.length > 200) {
      return fail('New password must contain at least 8 characters.');
    }
    const tokens = readPasswordResetTokens();
    let tokenIndex = -1;
    for (let index = 0; index < tokens.length; index += 1) {
      const candidate = tokens[index];
      if (await passwordDigest(token, candidate.tokenSalt) === candidate.tokenHash) {
        tokenIndex = index;
        break;
      }
    }
    if (tokenIndex < 0) return fail('This password reset has expired or was already used. Verify your recovery key and try again.');
    const reset = tokens[tokenIndex];
    const accounts = readAccounts();
    const account = accounts.find((item) => item.id === reset.accountId);
    if (!account) return fail('Account not found.');
    account.salt = makeId();
    account.passwordHash = await passwordDigest(password, account.salt);
    account.revision = (account.revision || 0) + 1;
    saveAccounts(accounts);
    const remainingTokens = tokens.filter((item) => item.accountId !== account.id);
    localStorage.setItem(PASSWORD_RESET_TOKENS_KEY, JSON.stringify(remainingTokens));
    const sessions = readSessions();
    for (const [session, accountId] of Object.entries(sessions)) {
      if (accountId === account.id) delete sessions[session];
    }
    localStorage.setItem(MOCK_SESSIONS_KEY, JSON.stringify(sessions));
    return { ok: true };
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const account = readAccounts().find((item) => item.email.toLowerCase() === email);
    if (!account || await passwordDigest(password, account.salt) !== account.passwordHash) {
      return fail('Email or password is incorrect.');
    }
    if (account.status !== 'approved') return fail('This account is not active.');
    return { token: issueSession(account.id), account: publicAccount(account) };
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const headers = new Headers(options.headers || {});
    const token = (headers.get('Authorization') || `Bearer ${accessToken}`).replace(/^Bearer\s+/i, '');
    const sessions = readSessions();
    delete sessions[token];
    localStorage.setItem(MOCK_SESSIONS_KEY, JSON.stringify(sessions));
    return { ok: true };
  }

  if (path === '/api/investments/mark' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    const quotes = body.quotes && typeof body.quotes === 'object' ? body.quotes : {};
    if (updateMarketInvestments(account, quotes)) persistAccount(account);
    return { account: publicAccount(account) };
  }

  if (path === '/api/investments/auto-redeem' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    const investment = account.investments.find((item) => item.id === String(body.investmentId || ''));
    if (!investment || investment.status !== 'active') return fail('Active investment not found.');
    if (typeof body.enabled !== 'boolean') return fail('Invalid automatic redemption setting.');
    const percent = Number(body.percent);
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) return fail('Percentage must be between 1 and 100.');
    investment.autoRedeemEnabled = body.enabled;
    investment.autoRedeemPercent = percent;
    return { account: persistAccount(account) };
  }

  if (path === '/api/account' && method === 'GET') {
    const account = getSessionAccount(accessToken, options);
    return { account: publicAccount(account) };
  }

  if (path === '/api/deposit-addresses' && method === 'GET') {
    getSessionAccount(accessToken, options);
    return { addresses: readDepositAddresses() };
  }

  if (path === '/api/admin/deposit-addresses' && method === 'PUT') {
    const admin = getSessionAccount(accessToken, options);
    if (admin.role !== 'admin') return fail('Not authorized.');
    const addresses = {};
    for (const network of NETWORKS) {
      addresses[network] = String(body.addresses?.[network] || '').trim();
      if (addresses[network].length > 300) return fail('A deposit address is too long.');
    }
    localStorage.setItem(DEPOSIT_ADDRESSES_KEY, JSON.stringify(addresses));
    return { addresses };
  }

  if (path === '/api/admin/accounts' && method === 'GET') {
    const admin = getSessionAccount(accessToken, options);
    if (admin.role !== 'admin') return fail('Not authorized.');
    const accounts = readAccounts();
    for (const account of accounts) {
      }
    return { accounts: readAccounts().map(publicAccount) };
  }

  if (path === '/api/admin/rewards/credit' && method === 'POST') {
    const admin = getSessionAccount(accessToken, options);
    if (admin.role !== 'admin') return fail('Not authorized.');
    const points = Number(body.points || 0);
    const spins = Number(body.spins || 0);
    if (!Number.isSafeInteger(points) || points < 0 ||
        !Number.isSafeInteger(spins) || spins < 0 || (points === 0 && spins === 0)) {
      return fail('Enter a positive whole number of points or extra spins.');
    }
    const target = readAccounts().find((account) => account.id === body.accountId);
    if (!target) return fail('Account not found.');
    if (!Number.isSafeInteger((target.h9Points || 0) + points) ||
        !Number.isSafeInteger((target.bonusSpins || 0) + spins)) {
      return fail('The new points or spin balance is too large.');
    }
    if (points > 0) {
      target.h9Points = (target.h9Points || 0) + points;
      pointEntry(target, points, 'admin-credit', 'Points credited by admin');
    }
    if (spins > 0) target.bonusSpins = (target.bonusSpins || 0) + spins;
    return { account: persistAccount(target) };
  }

  if (path === '/api/admin/accounts' && method === 'DELETE') {
    const admin = getSessionAccount(accessToken, options);
    if (admin.role !== 'admin') return fail('Not authorized.');
    localStorage.removeItem(MOCK_ACCOUNTS_KEY);
    localStorage.removeItem(MOCK_SESSIONS_KEY);
    return { ok: true };
  }

  if ((path === '/api/account' || path === '/api/admin/account') && method === 'PUT') {
    const sessionAccount = getSessionAccount(accessToken, options);
    if (path === '/api/admin/account' && sessionAccount.role !== 'admin') return fail('Not authorized.');
    const target = path === '/api/account'
      ? sessionAccount
      : readAccounts().find((account) => account.id === body.id);
    if (!target) return fail('Account not found.');
    if (Number(body.revision) !== target.revision) {
      return fail('This account changed in another session. Refresh and try again.');
    }
    if (path === '/api/admin/account' && target.id !== sessionAccount.id) {
      if (!body.wallet || !Number.isFinite(Number(body.wallet.deposit)) ||
          !Number.isFinite(Number(body.wallet.earnings)) ||
          Number(body.wallet.deposit) < 0 || Number(body.wallet.earnings) < 0) {
        return fail('Enter valid non-negative balances.');
      }
      if (!['approved', 'blocked', 'pending', 'rejected'].includes(body.status || target.status)) {
        return fail('Invalid account status.');
      }
      target.wallet = {
        deposit: Number(body.wallet.deposit),
        earnings: Number(body.wallet.earnings),
      };
      target.status = body.status || target.status;
      if (Array.isArray(body.transactions)) target.transactions = body.transactions;
      if (Array.isArray(body.depositRequests)) target.depositRequests = body.depositRequests;
      if (Array.isArray(body.withdrawalRequests)) target.withdrawalRequests = body.withdrawalRequests;
      if (body.reviewedAt !== undefined) target.reviewedAt = body.reviewedAt;
      return { account: persistAccount(target) };
    }
    Object.assign(target, {
      wallet: body.wallet || target.wallet,
      investments: body.investments || target.investments,
      transactions: body.transactions || target.transactions,
      depositRequests: body.depositRequests || target.depositRequests,
      withdrawalRequests: body.withdrawalRequests || target.withdrawalRequests,
      preferences: body.preferences || target.preferences || { language: 'en', theme: 'dark' },
    });
    return { account: persistAccount(target) };
  }

  if (path === '/api/withdrawal-wallet' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    const network = String(body.network || '');
    const address = String(body.address || '').trim();
    if (!NETWORKS.includes(network) || !address || address.length > 300) {
      return fail('Enter a valid network and wallet address.');
    }
    if (!account.withdrawalWallet) {
      account.withdrawalWallet = { network, address, linkedAt: Date.now() };
      return { account: persistAccount(account), requested: false };
    }
    if (account.withdrawalWallet.network === network && account.withdrawalWallet.address === address) {
      return fail('This wallet is already linked.');
    }
    account.walletChangeRequests ||= [];
    if (account.walletChangeRequests.some((request) => request.status === 'pending')) {
      return fail('A wallet change request is already awaiting admin review.');
    }
    const request = {
      id: makeId(), network, address, status: 'pending', createdAt: Date.now(),
      previousNetwork: account.withdrawalWallet.network,
      previousAddress: account.withdrawalWallet.address,
    };
    account.walletChangeRequests.unshift(request);
    return { account: persistAccount(account), requested: true };
  }

  if (path === '/api/admin/wallet-change' && method === 'POST') {
    const admin = getSessionAccount(accessToken, options);
    if (admin.role !== 'admin') return fail('Not authorized.');
    const target = readAccounts().find((item) => item.id === body.accountId);
    if (!target) return fail('Account not found.');
    const request = (target.walletChangeRequests || []).find((item) =>
      item.id === body.requestId && item.status === 'pending');
    if (!request) return fail('Wallet change request not found.');
    if (body.decision === 'approve') {
      target.withdrawalWallet = {
        network: request.network, address: request.address, linkedAt: Date.now(),
      };
      request.status = 'approved';
    } else if (body.decision === 'reject') {
      request.status = 'rejected';
    } else {
      return fail('Invalid wallet review decision.');
    }
    request.reviewedAt = Date.now();
    return { account: persistAccount(target) };
  }

  if (path === '/api/auth/withdrawal-password' && method === 'PUT') {
    const account = getSessionAccount(accessToken, options);
    const loginPassword = String(body.loginPassword || '');
    const pin = String(body.pin || '');
    if (!/^\d{6}$/.test(pin)) return fail('Withdrawal password must contain exactly 6 digits.');
    if (await passwordDigest(loginPassword, account.salt) !== account.passwordHash) {
      return fail('Login password is incorrect.');
    }
    if (await passwordDigest(pin, account.salt) === account.passwordHash) {
      return fail('Withdrawal password must differ from the login password.');
    }
    const pinSalt = makeId();
    account.withdrawalPinSalt = pinSalt;
    account.withdrawalPinHash = await passwordDigest(pin, pinSalt);
    return { account: persistAccount(account) };
  }

  if (path === '/api/auth/password' && method === 'PUT') {
    const account = getSessionAccount(accessToken, options);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 8 || newPassword.length > 200) return fail('New password must contain at least 8 characters.');
    if (await passwordDigest(currentPassword, account.salt) !== account.passwordHash) return fail('Current password is incorrect.');
    account.salt = makeId();
    account.passwordHash = await passwordDigest(newPassword, account.salt);
    return { account: persistAccount(account) };
  }

  if (path === '/api/rewards/purchase' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    const reward = REWARDS.find((item) => item.id === body.rewardId);
    if (!reward) return fail('This reward is unavailable.');
    if ((account.h9Points || 0) < reward.points) return fail('You do not have enough H9 points.');
    if (reward.type === 'boost' &&
        (account.activeBonuses || []).some((bonus) => bonus.type === 'double-earnings' && bonus.expiresAt > Date.now())) {
      return fail('Use or wait for your current earnings boost to expire first.');
    }

    account.h9Points -= reward.points;
    pointEntry(account, -reward.points, 'spend', reward.title, { rewardId: reward.id });
    if (reward.type === 'boost') {
      const startedAt = Date.now();
      const bonus = {
        id: makeId(), type: 'double-earnings', multiplier: 2,
        title: reward.title, startedAt, expiresAt: startedAt + reward.hours * 3_600_000,
      };
      account.activeBonuses.unshift(bonus);
      account.transactions.unshift(transaction('bonus', 0, '', 'completed', {
        bonusId: bonus.id, planName: bonus.title,
      }));
    } else {
      const redemption = {
        id: makeId(), rewardId: reward.id, title: reward.title,
        amount: reward.amount, status: 'credited', balanceDestination: 'deposit',
        requestedAt: Date.now(), creditedAt: Date.now(),
      };
      account.rewardRedemptions.unshift(redemption);
      account.wallet.deposit += reward.amount;
      account.transactions.unshift(transaction('coupon', reward.amount, '', 'completed', {
        redemptionId: redemption.id, planName: reward.title,
      }));
    }
    return { account: persistAccount(account) };
  }

  if (path === '/api/rewards/spin' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    const today = new Date().toISOString().slice(0, 10);
    const usedDailySpin = account.lastDailyPrizeDate === today;
    if (usedDailySpin && (account.bonusSpins || 0) < 1) {
      return fail('You already used today’s spin and have no extra spins.');
    }
    if (usedDailySpin) account.bonusSpins -= 1;
    else account.lastDailyPrizeDate = today;
    const prize = chooseDailyPrize(secureTicket(DAILY_TICKET_POOL));
    account.dailyPrizes ||= [];
    account.dailyPrizes.unshift({
      id: makeId(), prizeId: prize.id, points: prize.points,
      spinType: usedDailySpin ? 'extra' : 'daily', date: Date.now(),
    });
    account.h9Points = (account.h9Points || 0) + prize.points;
    pointEntry(account, prize.points, 'daily-prize', `Daily mystery box · ${prize.points} H9 points`, {
      prizeId: prize.id,
    });
    return { account: persistAccount(account), prize };
  }

  if (path === '/api/deposits' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    const amount = Number(body.amount);
    const network = String(body.network || '');
    const txHash = String(body.txHash || '').trim();
    if (!Number.isFinite(amount) || amount <= 0 || !NETWORKS.includes(network) || !txHash) {
      return fail('Invalid amount, network or transaction hash.');
    }
    const depositAddress = readDepositAddresses()[network];
    if (!depositAddress) return fail('Deposit address is not configured for this network.');
    if (String(body.depositAddress || '').trim() !== depositAddress) {
      return fail('The deposit address changed. Reopen the deposit request and use the current address.');
    }
    const request = { id: makeId(), amount, network, depositAddress, txHash, status: 'pending', createdAt: Date.now() };
    const entry = transaction('deposit', amount, network, 'pending', { requestId: request.id });
    request.transactionId = entry.id;
    account.depositRequests.unshift(request);
    account.transactions.unshift(entry);
    return { account: persistAccount(account) };
  }

  if (path === '/api/withdrawals' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    const amount = Number(body.amount);
    const network = String(body.network || '');
    const address = String(body.address || '').trim();
    const pin = String(body.pin || '');
    if (!Number.isFinite(amount) || amount <= 0 || !NETWORKS.includes(network) || !address) {
      return fail('Invalid amount, network or address.');
    }
    if (amount > account.wallet.earnings) return fail('Insufficient earnings balance.');
    if (!account.withdrawalWallet) return fail('Link a withdrawal wallet before requesting a withdrawal.');
    if (account.withdrawalWallet.network !== network || account.withdrawalWallet.address !== address) {
      return fail('Withdrawals must use your linked wallet and network.');
    }
    if (!account.withdrawalPinHash || !account.withdrawalPinSalt) {
      return fail('Set your withdrawal password before requesting a withdrawal.');
    }
    if (await passwordDigest(pin, account.withdrawalPinSalt) !== account.withdrawalPinHash) {
      return fail('Withdrawal password is incorrect.');
    }
    account.wallet.earnings -= amount;
    const request = {
      id: makeId(), amount, network, address, status: 'pending', createdAt: Date.now(),
    };
    const entry = transaction('withdrawal', amount, network, 'pending', {
      requestId: request.id, addressHint: `…${address.slice(-6)}`,
    });
    request.transactionId = entry.id;
    account.withdrawalRequests.unshift(request);
    account.transactions.unshift(entry);
    return { account: persistAccount(account) };
  }

  if (path === '/api/earnings/redeem' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    updateMarketInvestments(account, body.quotes || {});
    const selectedInvestments = body.investmentId
      ? [account.investments.find((investment) => investment.id === body.investmentId)].filter(Boolean)
      : account.investments;
    if (body.investmentId && selectedInvestments.length === 0) {
      return fail('Investment not found.');
    }
    const redemptions = selectedInvestments
      .filter((investment) => investment.status === 'active')
      .map((investment) => ({
        investment,
        amount: Math.max(0, Number(investment.marketValue) - Number(investment.principal)),
      }))
      .filter((entry) => entry.amount > 0);
    const amount = redemptions.reduce((sum, entry) => sum + entry.amount, 0);
    if (!(amount > 0)) return fail('There are no redeemable profits available for this investment.');
    for (const { investment, amount: redeemedAmount } of redemptions) {
      investment.marketValue -= redeemedAmount;
      investment.marketTrackingValue = investment.marketValue;
      investment.compoundBalance = 0;
      const planName = investment.planName || PLANS.find((plan) => plan.id === investment.planId)?.name || `${investment.days}-day plan`;
      account.transactions.unshift(transaction('earning-redemption', redeemedAmount, '', 'completed', {
        investmentId: investment.id,
        planName,
      }));
    }
    account.wallet.earnings += amount;
    return { account: persistAccount(account), amount };
  }

  if (path === '/api/custom-plan/subscribe' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    if (account.customPlanSubscription?.expiresAt > Date.now()) return fail('Custom-plan access is already active.');
    if (Number(account.wallet.deposit) < 50) return fail('At least 50 USDT is required in your deposit balance.');
    const now = Date.now();
    account.wallet.deposit -= 50;
    account.customPlanSubscription = { startedAt: now, expiresAt: now + 365 * DAY_MS, amount: 50 };
    account.transactions.unshift(transaction('subscription', 50, '', 'completed', {
      planName: 'Custom plan · annual access',
      balanceType: 'deposit',
    }));
    return { account: persistAccount(account) };
  }

  if (path === '/api/investments' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    const amount = Number(body.amount);
    const isCustom = body.planId === 'custom';
    const plan = PLANS.find((item) => item.id === body.planId);
    let allocations = plan?.allocations || [];
    let months = plan?.months;
    let stopLossPercent = 20;
    let autoRedeemPercent = 0;
    if (isCustom) {
      if (!(account.customPlanSubscription?.expiresAt > Date.now())) return fail('An active annual custom-plan subscription is required.');
      months = Number(body.months);
      stopLossPercent = Number(body.stopLossPercent);
      autoRedeemPercent = Number(body.autoRedeemPercent);
      if (![6, 12, 24, 36, 60].includes(months) || !Number.isInteger(stopLossPercent) || stopLossPercent < 1 || stopLossPercent > 80 ||
          !Number.isInteger(autoRedeemPercent) || autoRedeemPercent < 0 || autoRedeemPercent > 100) {
        return fail('Check the custom term, stop-loss and redemption settings.');
      }
      if (!Array.isArray(body.allocations) || body.allocations.length < 1 || body.allocations.length > CUSTOM_ASSETS.length) {
        return fail('Choose at least one supported asset.');
      }
      const allowedAssets = new Set(CUSTOM_ASSETS.map((asset) => asset.name));
      const names = new Set();
      allocations = body.allocations.map((item) => ({
        name: String(item?.name || ''),
        weight: Number(item?.weight),
      }));
      for (const item of allocations) {
        if (!allowedAssets.has(item.name) || names.has(item.name) ||
            !Number.isFinite(item.weight) || item.weight <= 0 || item.weight > 100) {
          return fail('Asset allocation contains an invalid asset or percentage.');
        }
        names.add(item.name);
      }
      const allocationTotal = allocations.reduce((sum, item) => sum + item.weight, 0);
      if (Math.abs(allocationTotal - 100) > 0.01) return fail('Asset allocation must total 100%.');
      allocations = allocations.map((item) => ({
        ...item,
        category: CUSTOM_ASSETS.find((asset) => asset.name === item.name)?.category || 'Custom',
      }));
    } else if (!plan) {
      return fail('Invalid plan or amount.');
    }
    if (!Number.isFinite(amount) || amount <= 0) return fail('Invalid plan or amount.');
    if (amount > account.wallet.deposit) return fail('Insufficient deposit balance.');
    const marketBasis = allocations.flatMap((item) => {
      const price = Number(body.quotes?.[item.name]);
      return price > 0 ? [{ name: item.name, price, weight: item.weight }] : [];
    });
    const initialPrices = Object.fromEntries(marketBasis.map((item) => [item.name, item.price]));
    const startedAt = Date.now();
    const maturityAt = contractMaturityAt(startedAt, months);
    const planName = isCustom ? 'Custom plan' : plan.name;
    const investment = {
      id: makeId(), planId: isCustom ? 'custom' : plan.id, planName,
      days: calendarDaysBetween(startedAt, maturityAt),
      principal: amount, marketValue: amount, marketTrackingValue: amount, startedAt, maturityAt,
      marketBasis, lastMarketPrices: initialPrices, protectionSuspended: false,
      stopLossPercent, autoRedeemEnabled: autoRedeemPercent > 0,
      autoRedeemPercent: autoRedeemPercent || 100,
      earningsCredited: 0, compoundBalance: 0, uncompoundedEarnings: 0,
      status: 'active', allocation: allocations.map((item) => ({ ...item })),
    };
    account.wallet.deposit -= amount;
    account.investments.unshift(investment);
    account.transactions.unshift(transaction('investment', amount, '', 'completed', {
      planName,
      investmentId: investment.id,
    }));
    return { account: persistAccount(account) };
  }

  return fail('This operation is currently unavailable.');
}
