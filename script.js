import { PLANS, CUSTOM_ASSETS, calendarDaysBetween } from './investment-model.js';
import { DAILY_PRIZES, REWARDS } from './rewards-model.js';
import { translatePage, translateText } from './localization.js';
import { getMarketQuote, refreshMarketQuotes, getMarketHistory, refreshMarketHistory } from './market-prices.js';
import { API_BASE_URL } from './api-config.js';

const SESSION_KEY = 'h9-test-session-v1';
const LANGUAGE_KEY = 'h9-interface-language-v1';
const DAY_MS = 86_400_000;
const NETWORKS = {
  bep20: 'BNB Chain · BEP-20',
  bitcoin: 'Bitcoin · USDT',
  trc20: 'TRON · TRC-20',
};
const LANGUAGES = ['en', 'fr', 'es', 'de', 'pt', 'hi', 'zh', 'it'];
const LANGUAGE_LOCALES = { en: 'en-US', fr: 'fr-FR', es: 'es-ES', de: 'de-DE', pt: 'pt-PT', hi: 'hi-IN', zh: 'zh-CN', it: 'it-IT' };
const TEAM_MEMBER_DETAILS = {
  michael: { name: 'Michael R. Thompson', role: 'CEO · CHIEF EXECUTIVE OFFICER', description: 'Company vision, strategy, and project development.', status: 'Appointment pending confirmation.' },
  alexander: { name: 'Alexander Vance', role: 'CTO · CHIEF TECHNOLOGY OFFICER', description: 'Platform, security, and digital infrastructure.', status: 'Appointment pending confirmation.' },
  david: { name: 'David K. Miller', role: 'COO · CHIEF OPERATING OFFICER', description: 'Processes, organization, and service quality.' },
  sarah: { name: 'Sarah L. Jenkins', role: 'LEGAL & COMPLIANCE', description: 'Responsibility and appointment under verification.' },
};
const $ = (id) => document.getElementById(id);
let language = LANGUAGES.includes(localStorage.getItem(LANGUAGE_KEY)) ? localStorage.getItem(LANGUAGE_KEY) : 'en';
const usd = (amount) => `${Number(amount || 0).toLocaleString(LANGUAGE_LOCALES[language] || 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
let accounts = [];
let current = null;
let accessToken = sessionStorage.getItem(SESSION_KEY) || '';
let pendingPasswordResetToken = '';
localStorage.removeItem(SESSION_KEY);
let selectedPlan = null;
let customDraft = null;
let selectedHistoryFilter = 'all';
let toastTimer;
let marketRefreshTimer;
let marketHistoryRequest = null;
let catalogHistoryTimer;
let wheelSpinning = false;
let pullStartY = null;
let depositAddresses = { bep20: '', bitcoin: '', trc20: '' };

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    throw new Error(result.error || result.message || 'Service temporarily unavailable.');
  }
  return result;
}

async function saveAccounts(target = current) {
  if (!target || !accessToken) return false;
  try {
    const isAdminEdit = current.role === 'admin' && target.id !== current.id;
    const result = await apiRequest(isAdminEdit ? '/api/admin/account' : '/api/account', {
      method: 'PUT',
      body: JSON.stringify({ ...target, id: target.id }),
    });
    Object.assign(target, result.account);
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}

function applyAccount(account) {
  const index = accounts.findIndex((item) => item.id === account.id);
  if (index >= 0) accounts[index] = account;
  current = account;
  render();
}

function setError(id, message = '') {
  $(id).textContent = translateText(message, language);
  $(id).classList.remove('success');
}

function toast(message) {
  const node = $('toast');
  node.textContent = translateText(message, language);
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2500);
}

function openTeamMember(memberId) {
  const member = TEAM_MEMBER_DETAILS[memberId];
  if (!member) return;
  $('team-member-title').textContent = member.name;
  $('team-member-role').textContent = translateText(member.role, language);
  $('team-member-description').textContent = translateText(member.description, language);
  const status = $('team-member-status');
  status.hidden = !member.status;
  status.textContent = member.status ? translateText(member.status, language) : '';
  $('team-member-dialog').showModal();
}

function timestampDate(value) {
  return new Date(value).toLocaleDateString(LANGUAGE_LOCALES[language] || 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timestampDateTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—';
  return new Date(timestamp).toLocaleString(LANGUAGE_LOCALES[language] || 'en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  });
}

function movementAmount(transaction) {
  const value = usd(transaction.amount);
  if (transaction.type === 'account-adjustment') {
    return `${transaction.direction === 'debit' ? '−' : '+'}${value}`;
  }
  if (['deposit', 'earnings', 'compounding', 'earning-redemption', 'maturity', 'coupon', 'withdrawal-refund'].includes(transaction.type)) {
    return `+${value}`;
  }
  if (['investment', 'withdrawal', 'subscription'].includes(transaction.type)) return `−${value}`;
  return value;
}

function earningsNoticeKey(accountId = current?.id) {
  return `h9-earnings-notice-v1:${accountId || 'guest'}`;
}

function readEarningsNoticeState() {
  try {
    const state = JSON.parse(localStorage.getItem(earningsNoticeKey()) || '{}');
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

function openApp(account) {
  current = account;
  language = LANGUAGES.includes(account.preferences?.language) ? account.preferences.language : language;
  localStorage.setItem(LANGUAGE_KEY, language);
  document.documentElement.lang = language;
  $('landing-language-select').value = language;
  $('language-select').value = language;
  selectedHistoryFilter = 'all';
  if (accessToken) sessionStorage.setItem(SESSION_KEY, accessToken);
  $('landing').hidden = true;
  $('auth-screen').hidden = true;
  $('app-shell').hidden = false;
  $('bottom-nav').hidden = false;
  render();
  refreshAccount();
  apiRequest('/api/deposit-addresses').then(({ addresses }) => {
    depositAddresses = addresses || depositAddresses;
    if (current?.role === 'admin') {
      for (const network of Object.keys(depositAddresses)) {
        const field = $(`admin-address-${network}`);
        if (field) field.value = depositAddresses[network];
      }
    }
    refreshDepositAddressDisplay();
    if (current?.role === 'admin') renderAdmin();
  }).catch(() => {});
  setView('home');
  scheduleMarketAccountRefresh();
  if (current.role === 'admin') {
    apiRequest('/api/admin/accounts').then(({ accounts: list }) => {
      accounts = list;
      current = accounts.find((item) => item.id === current.id) || current;
      render();
    }).catch((error) => toast(error.message));
  }
}

function signOut() {
  clearInterval(marketRefreshTimer);
  marketRefreshTimer = undefined;
  if (accessToken) apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
  current = null;
  accessToken = '';
  accounts = [];
  customDraft = null;
  language = LANGUAGES.includes(localStorage.getItem(LANGUAGE_KEY)) ? localStorage.getItem(LANGUAGE_KEY) : 'en';
  document.documentElement.lang = language;
  $('landing-language-select').value = language;
  sessionStorage.removeItem(SESSION_KEY);
  $('app-shell').hidden = true;
  $('bottom-nav').hidden = true;
  $('auth-screen').hidden = true;
  $('landing').hidden = false;
  showAuthMode('login');
  if (name === 'catalog') {
    loadAssetHistory();
    if (!catalogHistoryTimer) {
      catalogHistoryTimer = setInterval(() => {
        if (!document.hidden && $('view-catalog').classList.contains('active')) loadAssetHistory();
      }, 60_000);
    }
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showAuthMode(mode) {
  $('landing').hidden = true;
  $('auth-screen').hidden = false;
  const register = mode === 'register';
  $('auth-entry').hidden = false;
  $('login-form').hidden = register;
  $('register-form').hidden = !register;
  $('password-reset-request-form').hidden = true;
  $('password-reset-form').hidden = true;
  $('forgot-password-button').hidden = register;
  $('auth-switch').hidden = false;
  $('auth-title').textContent = register ? 'Create your account' : 'Welcome back';
  $('auth-subtitle').textContent = register ? 'Create your You Invest account.' : 'Sign in to your You Invest account.';
  $('show-login').classList.toggle('selected', !register);
  $('show-register').classList.toggle('selected', register);
  translatePage(language);
}

function balanceTotal() {
  const activePortfolio = current.investments
    .filter((investment) => investment.status === 'active')
    .reduce((sum, investment) => sum + (Number(investment.marketValue) || investment.principal), 0);
  return current.wallet.deposit + current.wallet.earnings + activePortfolio;
}

function redeemableEarnings() {
  return (current?.investments || []).reduce(
    (sum, investment) => sum + (investment.status === 'active'
      ? Math.max(0, Number(investment.marketValue) - Number(investment.principal))
      : 0),
    0,
  );
}

async function refreshAccount() {
  if (!current) return;
  try {
    await refreshMarketQuotes();
    updateVisibleMarketQuotes();
    await apiRequest('/api/investments/mark', {
      method: 'POST',
      body: JSON.stringify({ quotes: currentMarketQuotes() }),
    });
    const { account } = await apiRequest('/api/account');
    if (account.role === 'admin') {
      const { accounts: list } = await apiRequest('/api/admin/accounts');
      accounts = list;
      current = accounts.find((item) => item.id === account.id) || account;
    } else {
      const index = accounts.findIndex((item) => item.id === account.id);
      if (index >= 0) accounts[index] = account;
      current = account;
    }
    render();
    return true;
  } catch (error) {
    if (/session expired|not active/i.test(error.message)) {
      signOut();
      setError('login-error', /not active/i.test(error.message)
        ? 'This account is not active.'
        : 'Session expired. Please log in again.');
    } else {
      toast(error.message);
    }
    return false;
  }
}

function scheduleMarketAccountRefresh() {
  clearInterval(marketRefreshTimer);
  if (!current) return;
  marketRefreshTimer = setInterval(() => {
    if (current && document.visibilityState !== 'hidden') refreshAccount();
  }, 60_000);
}

async function resumeSession() {
  if (!accessToken) return;
  try {
    await refreshMarketQuotes();
    await apiRequest('/api/investments/mark', {
      method: 'POST',
      body: JSON.stringify({ quotes: currentMarketQuotes() }),
    });
    const { account } = await apiRequest('/api/account');
    current = account;
    accounts = [account];
    openApp(account);
  } catch (error) {
    accessToken = '';
    sessionStorage.removeItem(SESSION_KEY);
    setError('login-error', error.message);
  }
}

function renderPlan(plan, compact = false) {
  return `<article class="plan-card ${compact ? 'compact' : ''}" data-plan-card="${plan.id}">
    <div class="plan-card-top"><span class="duration-tag">${translateText(plan.months === 6 ? '6 months' : plan.months === 12 ? '1 year' : (plan.months / 12) + ' years', language)}</span><span class="plan-lock">${translateText('Capital locked', language)}</span></div>
    <h3>${esc(translateText(plan.name, language))}</h3>
    <div class="plan-rate market-plan-rate">${translateText('Market-linked', language)}<small>${translateText('variable value', language)}</small></div>
    <div class="plan-data"><span>${translateText('Capital protection', language)}</span><b>-20%</b></div>
    <p class="plan-description">${translateText('Portfolio value follows live market prices. No fixed daily return.', language)}</p>
    <button class="primary-button" type="button" data-plan-details="${plan.id}">${compact ? 'Details' : 'Plan details'}</button>
  </article>`;
}

function createCustomDraft() {
  const defaults = Object.fromEntries(PLANS[0].allocations.map((asset) => [asset.name, asset.weight]));
  return {
    amount: '', months: 12, stopLossPercent: 20, autoRedeemPercent: 0,
    allocations: Object.fromEntries(CUSTOM_ASSETS.map((asset) => [asset.name, {
      selected: true, weight: defaults[asset.name] || 0,
    }])),
  };
}

function customAllocationTotal() {
  return Object.values(customDraft?.allocations || {}).reduce(
    (sum, asset) => sum + (asset.selected ? Number(asset.weight) || 0 : 0), 0,
  );
}

function updateCustomAllocationSummary() {
  const total = customAllocationTotal();
  const label = $('custom-allocation-total');
  const button = $('custom-invest-button');
  if (!label || !button) return;
  label.textContent = total.toLocaleString(LANGUAGE_LOCALES[language], { maximumFractionDigits: 2 }) + '% / 100%';
  label.classList.toggle('valid', Math.abs(total - 100) <= 0.01);
  button.disabled = Math.abs(total - 100) > 0.01 || !Object.values(customDraft.allocations).some((asset) => asset.selected);
}

function renderCustomPlan() {
  const section = $('custom-plan-section');
  if (!section || !current) return;
  const subscription = current.customPlanSubscription;
  const hasAccess = Number(subscription?.expiresAt) > Date.now();
  if (!hasAccess) {
    const balance = Number(current.wallet?.deposit) || 0;
    section.innerHTML = '<div class="custom-plan-head"><div><p class="eyebrow">' + translateText('ANNUAL ACCESS', language) + '</p><h2 id="custom-plan-title">' + translateText('Custom plan', language) + '</h2><p>' + translateText('Choose assets, allocation, stop-loss, and automatic redemption.', language) + '</p></div><strong class="custom-plan-price">$50<small> / ' + translateText('year', language) + '</small></strong></div><div class="custom-plan-unlock"><span>' + translateText('Available deposit balance', language) + ': <b>' + usd(balance) + '</b></span><button class="primary-button" type="button" data-unlock-custom-plan ' + (balance < 50 ? 'disabled' : '') + '>' + translateText('Unlock for $50 USDT', language) + '</button></div><p class="custom-plan-note">' + translateText('Annual access is charged to your USDT deposit balance. This demo does not send an external payment.', language) + '</p>';
    return;
  }
  customDraft ||= createCustomDraft();
  const durationOptions = [6, 12, 24, 36, 60].map((months) => {
    const name = months === 6 ? '6 months' : months === 12 ? '1 year' : (months / 12) + ' years';
    return '<option value="' + months + '" ' + (Number(customDraft.months) === months ? 'selected' : '') + '>' + translateText(name, language) + '</option>';
  }).join('');
  const assetRows = CUSTOM_ASSETS.map((asset) => {
    const config = customDraft.allocations[asset.name];
    return '<div class="custom-asset-row"><label><input type="checkbox" data-custom-asset="' + esc(asset.name) + '" ' + (config.selected ? 'checked' : '') + '><span>' + esc(asset.name) + '</span></label><div><input type="number" min="0.1" max="100" step="0.1" value="' + esc(config.weight) + '" data-custom-weight="' + esc(asset.name) + '" ' + (config.selected ? '' : 'disabled') + ' aria-label="' + esc(asset.name) + ' allocation percentage"><span>%</span></div></div>';
  }).join('');
  section.innerHTML = '<div class="custom-plan-head"><div><p class="eyebrow">' + translateText('ANNUAL ACCESS', language) + '</p><h2 id="custom-plan-title">' + translateText('Custom plan', language) + '</h2><p>' + translateText('Access until', language) + ' ' + timestampDate(subscription.expiresAt) + '</p></div><span class="custom-plan-active">' + translateText('Active', language) + '</span></div><form id="custom-plan-form" class="custom-plan-form"><div class="custom-assets-heading"><b>' + translateText('Choose assets and allocation', language) + '</b><span id="custom-allocation-total"></span></div><div class="custom-asset-list">' + assetRows + '</div><div class="custom-form-grid"><label>' + translateText('Investment amount (USDT)', language) + '<input type="number" min="0.000001" step="any" required data-custom-field="amount" value="' + esc(customDraft.amount) + '"></label><label>' + translateText('Contract term', language) + '<select data-custom-field="months">' + durationOptions + '</select></label><label>' + translateText('Stop-loss threshold (%)', language) + '<input type="number" min="1" max="80" step="1" required data-custom-field="stopLossPercent" value="' + esc(customDraft.stopLossPercent) + '"></label><label>' + translateText('Auto-redeem new profits (%)', language) + '<input type="number" min="0" max="100" step="1" required data-custom-field="autoRedeemPercent" value="' + esc(customDraft.autoRedeemPercent) + '"></label></div><p class="form-error" id="custom-plan-error" role="alert"></p><button class="primary-button" id="custom-invest-button" type="submit">' + translateText('Create custom investment', language) + '</button><p class="custom-plan-note">' + translateText('Selected asset weights must total 100%. A 0% auto-redemption setting keeps all profits invested.', language) + '</p></form>';
  updateCustomAllocationSummary();
}

function renderInvestment(investment, ended = false) {
  const plan = PLANS.find((item) => item.id === investment.planId);
  const maturityAt = investment.maturityAt || investment.startedAt + investment.days * DAY_MS;
  const totalDays = Math.max(1, calendarDaysBetween(investment.startedAt, maturityAt));
  const remainingDays = ended ? 0 : Math.max(0, calendarDaysBetween(Date.now(), maturityAt));
  const elapsedDays = totalDays - remainingDays;
  const progress = Math.max(0, Math.min(100, (elapsedDays / totalDays) * 100));
  const marketValue = Number(investment.marketValue) || investment.principal;
  const marketChange = (marketValue / investment.principal - 1) * 100;
  const suspended = !ended && investment.protectionSuspended;
  const status = ended ? 'Completed' : suspended ? 'Suspended at stop loss' : 'Active';
  const redeemable = ended ? 0 : Math.max(0, marketValue - investment.principal);
  const autoRedeemEnabled = investment.autoRedeemEnabled === true;
  const autoRedeemPercent = Math.min(100, Math.max(1, Number(investment.autoRedeemPercent) || 100));
  const stopLossPercent = Math.min(80, Math.max(1, Number(investment.stopLossPercent) || 20));
  return `<article class="investment-card">
    <div class="investment-card-head"><div><b>${esc(plan?.name || investment.planName || `${investment.days}-day plan`)}</b><span>${translateText('Locked capital', language)} ${usd(marketValue)} (${marketChange >= 0 ? '+' : ''}${marketChange.toLocaleString(LANGUAGE_LOCALES[language], { maximumFractionDigits: 2 })}%)</span></div><span class="state-badge ${ended ? 'ended' : suspended ? 'protected' : 'active'}">${translateText(status, language)}</span></div>
    <div class="progress-track"><i style="width:${progress}%"></i></div>
    <div class="investment-live-values"><div><span>${translateText('Locked capital', language)}</span><b>${usd(marketValue)}</b></div><div><span>${translateText('Redeemable profits', language)}</span><b>${usd(redeemable)}</b></div><div><span>${translateText('Current portfolio value', language)}</span><b>${usd(marketValue)}</b></div></div>
    <div class="investment-details"><span>${ended ? `Completed ${timestampDate(investment.maturedAt)}` : `${remainingDays} ${translateText('days remaining', language)} · ${translateText('Matures', language)} ${timestampDate(maturityAt)}`}</span><span>${translateText('Protection threshold', language)} <b>${usd(investment.principal * (1 - stopLossPercent / 100))} (${stopLossPercent}%)</b></span></div>
    ${ended ? `<div class="released-line">${translateText('Maturity value returned to deposit balance', language)} · ${usd(marketValue)}</div>` : `<div class="released-line">${translateText('Market-linked contract. No fixed daily return.', language)}</div>`}
    
    ${!ended ? `<div class="auto-redeem-control"><label class="auto-redeem-toggle"><input type="checkbox" data-auto-redeem="${esc(investment.id)}" ${autoRedeemEnabled ? 'checked' : ''}><span>${translateText('Auto-redeem profits', language)}</span></label><label class="auto-redeem-rate"><input type="number" inputmode="numeric" min="1" max="100" step="1" value="${autoRedeemPercent}" data-auto-redeem-percent="${esc(investment.id)}" aria-label="${translateText('Auto-redeem percentage', language)}" ${autoRedeemEnabled ? '' : 'disabled'}><span>% ${translateText('of new profits', language)}</span></label></div>` : ''}
    <div class="investment-actions">
      <button class="text-link investment-detail-button" type="button" data-investment-detail="${esc(investment.id)}">${translateText('Investment details', language)} <span>→</span></button>
      ${redeemable > 0 ? `<button class="outline-button redeem-investment-button" type="button" data-redeem-investment="${esc(investment.id)}">${translateText('Redeem profits', language)} · ${usd(redeemable)}</button>` : ''}
    </div>
  </article>`;
}

function renderMarketQuoteContent(assetName) {
  const quote = getMarketQuote(assetName);
  if (!quote) return `<span>${translateText('Market quote', language)}</span><b class="market-quote-empty">${translateText('Waiting for market data...', language)}</b>`;
  const value = Number(quote.price).toLocaleString(LANGUAGE_LOCALES[language] || 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const marketTime = new Date(quote.marketAt).toLocaleString(LANGUAGE_LOCALES[language] || 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const price = [quote.currency, value, quote.unit].filter(Boolean).join(' ');
  return `<span>${translateText('Market quote', language)}</span><b>${price}</b><small>${esc(quote.instrument)} · ${esc(quote.provider)} · ${marketTime}</small>`;
}

const HISTORY_ASSETS = [
  ['gold', 'Gold', '#e8bf68'], ['oil', 'Oil', '#e68d64'], ['electricity', 'Electricity', '#79e2d5'],
  ['sp500', 'S&P 500', '#8bd482'], ['nasdaq', 'NASDAQ', '#79a8fa'], ['tesla', 'Tesla', '#f17d91'],
  ['artificialIntelligence', 'Artificial intelligence', '#bd92ef'], ['bitcoin', 'Bitcoin', '#f2a24b'], ['ethereum', 'Ethereum', '#8da9ff'],
];

function renderAssetHistoryChart() {
  const chart = $('asset-history-chart');
  if (!chart) return;
  const history = getMarketHistory();
  const locale = LANGUAGE_LOCALES[language] || 'en-US';
  const series = HISTORY_ASSETS.flatMap(([key, name, color]) => {
    const points = [...(history?.histories?.[key] || [])];
    const quote = getMarketQuote(name);
    const price = Number(quote?.price);
    const time = Number(quote?.marketAt);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(time) && time > 0) {
      const latest = points.at(-1);
      if (!latest || time > latest.time) points.push({ time, value: price });
      else if (time === latest.time) points[points.length - 1] = { time, value: price };
    }
    return points.length > 1 ? [{ key, name, color, points }] : [];
  });
  if (!series.length) {
    chart.innerHTML = '<p>' + translateText(history ? 'No historical market data available.' : 'Historical market data is loading...', language) + '</p>';
    $('asset-history-legend').innerHTML = '';
    $('asset-history-source').textContent = '';
    return;
  }
  const allPoints = series.flatMap((item) => item.points);
  const firstTime = Math.min(...allPoints.map((point) => point.time));
  const lastTime = Math.max(...allPoints.map((point) => point.time));
  const changes = series.flatMap((item) => item.points.map((point) => (point.value / item.points[0].value - 1) * 100));
  let min = Math.min(0, ...changes);
  let max = Math.max(0, ...changes);
  const padding = Math.max((max - min) * 0.12, 1);
  min -= padding;
  max += padding;
  const left = 46, right = 708, top = 12, bottom = 224;
  const x = (time) => left + (time - firstTime) / Math.max(1, lastTime - firstTime) * (right - left);
  const y = (value) => bottom - (value - min) / (max - min) * (bottom - top);
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = max - (max - min) * index / 4;
    const position = y(value);
    return '<line class="asset-history-grid" x1="' + left + '" y1="' + position + '" x2="' + right + '" y2="' + position + '"></line><text x="' + (left - 7) + '" y="' + (position + 3) + '" text-anchor="end">' + value.toFixed(1) + '%</text>';
  }).join('');
  const lines = series.map((item) => {
    const base = item.points[0].value;
    const points = item.points.map((point) => x(point.time).toFixed(1) + ',' + y((point.value / base - 1) * 100).toFixed(1)).join(' ');
    return '<polyline fill="none" stroke="' + item.color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="' + points + '"><title>' + esc(item.name) + '</title></polyline>';
  }).join('');
  const startLabel = new Date(firstTime).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const endLabel = new Date(lastTime).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  chart.innerHTML = '<svg viewBox="0 0 720 250" role="img" aria-label="' + esc(translateText('Real-time asset prices', language)) + '"><g>' + grid + '</g>' + lines + '<text x="' + left + '" y="244">' + esc(startLabel) + '</text><text x="' + right + '" y="244" text-anchor="end">' + esc(endLabel) + '</text></svg>';
  $('asset-history-legend').innerHTML = series.map((item) => {
    const points = item.points;
    const change = (points.at(-1).value / points[0].value - 1) * 100;
    const value = (change > 0 ? '+' : '') + change.toLocaleString(locale, { maximumFractionDigits: 1 }) + '%';
    const quote = getMarketQuote(item.name);
    const price = Number(quote?.price);
    const livePrice = Number.isFinite(price)
      ? ' · ' + [quote.currency, price.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), quote.unit].filter(Boolean).join(' ')
      : '';
    return '<span><i style="background:' + item.color + '"></i>' + esc(item.name) + ' ' + value + livePrice + '</span>';
  }).join('');
  const providers = [...new Set(Object.values(history.histories).map((points) => points.provider).filter(Boolean))];
  const sourceNames = ['Yahoo Finance', 'Kraken', 'Energy-Charts'];
  $('asset-history-source').textContent = translateText('Live market quotes ·', language) + ' ' + (providers.length ? providers.join(' · ') : sourceNames.join(' · '));
}

function loadAssetHistory() {
  if (marketHistoryRequest) return marketHistoryRequest;
  marketHistoryRequest = Promise.all([refreshMarketQuotes(), refreshMarketHistory()]).then(([, history]) => {
    updateVisibleMarketQuotes();
    if (history) renderAssetHistoryChart();
    else {
      $('asset-history-chart').innerHTML = '<p>' + translateText('Market data unavailable', language) + '</p>';
      $('asset-history-legend').innerHTML = '';
    }
  }).finally(() => {
    marketHistoryRequest = null;
  });
  return marketHistoryRequest;
}

function updateVisibleMarketQuotes() {
  document.querySelectorAll('.asset-market-price').forEach((node) => {
    node.innerHTML = renderMarketQuoteContent(node.dataset.assetName);
  });
}

function currentMarketQuotes() {
  return Object.fromEntries([...new Set(PLANS.flatMap((plan) => plan.allocations.map((item) => item.name)))]
    .map((name) => [name, Number(getMarketQuote(name)?.price)])
    .filter(([, price]) => Number.isFinite(price) && price > 0));
}

function renderAllocationRows(allocation) {
  return allocation.map((item) => {
    const weight = Math.max(0, Math.min(100, Number(item.weight) || 0));
    return `<div class="allocation-row">
      <div class="allocation-row-head">
        <span><b>${esc(item.name)}</b><small>${esc(item.category || 'Mercato')}</small></span>
        <span class="allocation-values"><b>${weight.toLocaleString(LANGUAGE_LOCALES[language])}%</b></span>
      </div>
      <div class="allocation-track"><i style="width:${weight}%"></i></div>
      <div class="asset-market-price" data-asset-name="${esc(item.name)}">${renderMarketQuoteContent(item.name)}</div>
    </div>`;
  }).join('');
}

function showPlanDetails(id) {
  selectedPlan = PLANS.find((plan) => plan.id === id);
  if (!selectedPlan) return;
  $('details-eyebrow').textContent = 'PLAN DETAILS';
  $('details-title').textContent = translateText(selectedPlan.name, language);
  $('details-overview').innerHTML = `
    <div><span>${translateText('Contract term', language)}</span><b>${translateText(selectedPlan.months === 6 ? '6 months' : selectedPlan.months === 12 ? '1 year' : (selectedPlan.months / 12) + ' years', language)}</b></div>
    <div><span>${translateText('Return model', language)}</span><b>${translateText('Market-linked, variable', language)}</b></div>
    <div><span>${translateText('Capital protection', language)}</span><b>-20%</b></div>`;
  $('allocation-intro').textContent = translateText('Portfolio value follows live market prices. No fixed daily return.', language);
  $('details-allocation').innerHTML = renderAllocationRows(selectedPlan.allocations);
  $('details-invest-button').hidden = false;
  translatePage(language);
  $('details-dialog').showModal();
}

function showInvestmentDetails(id) {
  const investment = current?.investments.find((item) => item.id === id);
  if (!investment) return;
  const plan = PLANS.find((item) => item.id === investment.planId);
  const allocation = investment.allocation?.length ? investment.allocation : (plan?.allocations || []);
  selectedPlan = plan || { allocations: allocation };
  const ended = investment.status === 'matured';
  const marketValue = Number(investment.marketValue) || investment.principal;
  const redeemable = ended ? 0 : Math.max(0, marketValue - investment.principal);
  const suspended = !ended && investment.protectionSuspended;
  const stopLossPercent = Math.min(80, Math.max(1, Number(investment.stopLossPercent) || 20));
  $('details-eyebrow').textContent = ended ? 'COMPLETED INVESTMENT' : suspended ? 'SUSPENDED INVESTMENT' : 'ACTIVE INVESTMENT';
  $('details-title').textContent = plan ? translateText(plan.name, language) : translateText(investment.planName || `${investment.days}-day plan`, language);
  $('details-overview').innerHTML = `
    <div><span>${translateText('Investment status', language)}</span><b>${translateText(ended ? 'Completed' : suspended ? 'Suspended at stop loss' : 'Active', language)}</b></div>
    <div><span>${translateText('Locked capital', language)}</span><b>${usd(marketValue)}</b></div>
    <div><span>${translateText('Current portfolio value', language)}</span><b>${usd(marketValue)}</b></div>
    <div><span>${translateText('Redeemable profits', language)}</span><b>${usd(redeemable)}</b></div>
    <div><span>${translateText('Days remaining', language)}</span><b>${Math.max(0, calendarDaysBetween(Date.now(), investment.maturityAt || investment.startedAt + investment.days * DAY_MS))}</b></div>
    <div><span>${translateText('Market change', language)}</span><b>${((marketValue / investment.principal - 1) * 100).toLocaleString(LANGUAGE_LOCALES[language], { maximumFractionDigits: 2 })}%</b></div>
    <div><span>${translateText('Capital protection threshold', language)}</span><b>${usd(investment.principal * (1 - stopLossPercent / 100))} (${stopLossPercent}% ${translateText('stop loss', language)})</b></div>
    <div><span>${translateText('Contract maturity', language)}</span><b>${timestampDate(investment.maturedAt || investment.startedAt + investment.days * DAY_MS)}</b></div>
    <div><span>${translateText('Started', language)}</span><b>${timestampDate(investment.startedAt)}</b></div>`;
  $('allocation-intro').textContent = translateText('Live reference quotes and portfolio allocation.', language);
  $('details-allocation').innerHTML = renderAllocationRows(allocation);
  $('details-invest-button').hidden = true;
  translatePage(language);
  $('details-dialog').showModal();
}

function renderActivity(transaction) {
  const titles = {
    deposit: 'Deposit',
    investment: 'Investment started',
    subscription: 'Custom plan subscription',
    earnings: 'Daily earnings',
    compounding: 'Daily return reinvested',
    'earning-redemption': 'Earnings redeemed',
    maturity: 'Portfolio value returned',
    withdrawal: 'Withdrawal request',
    'withdrawal-refund': 'Withdrawal refunded',
    coupon: 'Coupon redemption',
    bonus: 'Earnings boost activated',
    'account-adjustment': 'Balance adjustment',
  };
  const date = timestampDate(transaction.date);
  const status = {
    pending: 'Pending review',
    confirmed: 'Confirmed',
    completed: 'Completed',
    accredited: 'Credited',
    rejected: 'Rejected',
    requested: 'Pending redemption',
    compounded: 'Reinvested',
  }[transaction.status] || 'Recorded';
  const investmentReference = transaction.investmentId
    ? `${transaction.planName || 'Investment'} · #${String(transaction.investmentId).slice(0, 8)}`
    : '';
  const context = investmentReference || NETWORKS[transaction.network] || transaction.planName || '';
  return `<article class="activity-row">
    <span class="activity-mark" aria-hidden="true">${transaction.type === 'deposit' || transaction.type === 'maturity' || transaction.type === 'withdrawal-refund' || transaction.type === 'account-adjustment' && transaction.direction === 'credit' ? '↓' : transaction.type === 'withdrawal' || transaction.type === 'account-adjustment' && transaction.direction === 'debit' ? '↑' : '↗'}</span>
    <span class="activity-copy"><b>${translateText(titles[transaction.type] || 'Account activity', language)}</b><small>${esc(context ? `${translateText(context, language)} · ` : '')}${translateText(status, language)} · ${date}</small></span>
    <b class="activity-amount">${usd(transaction.amount)}</b>
  </article>`;
}

function movementCategory(transaction) {
  if (transaction.type === 'deposit') return 'deposits';
  if (transaction.type === 'withdrawal') return 'withdrawals';
  if (transaction.type === 'investment') return 'investments';
  if (transaction.type === 'account-adjustment' && transaction.direction === 'credit') return 'credits';
  if (['earnings', 'compounding', 'earning-redemption', 'maturity', 'coupon', 'withdrawal-refund'].includes(transaction.type)) return 'credits';
  return 'other';
}

function movementRequest(transaction) {
  if (transaction.type === 'deposit') {
    return (current.depositRequests || []).find((request) =>
      request.id === transaction.requestId || request.transactionId === transaction.id,
    ) || null;
  }
  if (transaction.type === 'withdrawal' || transaction.type === 'withdrawal-refund') {
    return (current.withdrawalRequests || []).find((request) =>
      request.id === transaction.requestId || request.transactionId === transaction.id,
    ) || null;
  }
  return null;
}

function renderMovement(transaction) {
  const request = movementRequest(transaction);
  const detailRows = [
    ['Date and time', timestampDateTime(transaction.date)],
    ['Movement type', translateText({
      deposit: 'Deposit',
      investment: 'Investment',
      subscription: 'Custom plan subscription',
      earnings: 'Earnings credited',
      compounding: 'Return reinvested',
      'earning-redemption': 'Earnings redeemed',
      maturity: 'Portfolio value returned',
      withdrawal: 'Withdrawal',
      'withdrawal-refund': 'Withdrawal refund',
      coupon: 'Reward credit',
      bonus: 'Bonus activated',
      'account-adjustment': 'Balance adjustment',
    }[transaction.type] || 'Other movement', language)],
    ['Status', translateText({
      pending: 'Pending review',
      confirmed: 'Confirmed',
      completed: 'Completed',
      accredited: 'Credited',
      rejected: 'Rejected',
      requested: 'Pending redemption',
      compounded: 'Reinvested',
    }[transaction.status] || 'Recorded', language)],
    ['Amount', movementAmount(transaction)],
  ];
  if (transaction.network) detailRows.push(['Network', NETWORKS[transaction.network] || transaction.network]);
  if (request?.createdAt) detailRows.push(['Request submitted', timestampDateTime(request.createdAt)]);
  if (request?.reviewedAt) detailRows.push(['Reviewed', timestampDateTime(request.reviewedAt)]);
  if (request?.txHash) detailRows.push(['Transaction hash', request.txHash]);
  if (request?.payoutHash) detailRows.push(['Payout hash', request.payoutHash]);
  if (request?.address) detailRows.push(['Destination address', request.address]);
  else if (transaction.addressHint) detailRows.push(['Destination address', transaction.addressHint]);
  if (transaction.planName) detailRows.push(['Plan or reference', transaction.planName]);
  if (transaction.balanceType) detailRows.push(['Balance affected', translateText(transaction.balanceType === 'deposit' ? 'Deposit balance' : 'Earnings balance', language)]);
  if (transaction.previousBalance !== undefined) detailRows.push(['Previous balance', usd(transaction.previousBalance)]);
  if (transaction.newBalance !== undefined) detailRows.push(['Updated balance', usd(transaction.newBalance)]);
  if (transaction.investmentId) detailRows.push(['Investment ID', transaction.investmentId]);
  if (transaction.earningDay) detailRows.push(['Accrual date', transaction.earningDay]);
  if (transaction.requestId) detailRows.push(['Request ID', transaction.requestId]);
  detailRows.push(['Movement ID', transaction.id]);

  const title = {
    deposit: 'Deposit', investment: 'Investment started', subscription: 'Custom plan subscription', earnings: 'Daily earnings',
    compounding: 'Daily return reinvested', 'earning-redemption': 'Earnings redeemed',
    maturity: 'Portfolio value returned', withdrawal: 'Withdrawal request',
    'withdrawal-refund': 'Withdrawal refunded',
    coupon: 'Coupon redemption', bonus: 'Earnings boost activated',
    'account-adjustment': 'Balance adjustment',
  }[transaction.type] || 'Account activity';
  const status = {
    pending: 'Pending review', confirmed: 'Confirmed', completed: 'Completed',
    accredited: 'Credited', rejected: 'Rejected', requested: 'Pending redemption',
    compounded: 'Reinvested',
  }[transaction.status] || 'Recorded';
  const context = transaction.investmentId
    ? `${transaction.planName || 'Investment'} · #${String(transaction.investmentId).slice(0, 8)}`
    : NETWORKS[transaction.network] || transaction.planName || '';
  return `<details class="movement-entry">
    <summary class="movement-summary">
      <span class="activity-mark" aria-hidden="true">${transaction.type === 'deposit' || transaction.type === 'maturity' || transaction.type === 'withdrawal-refund' || transaction.type === 'account-adjustment' && transaction.direction === 'credit' ? '↓' : transaction.type === 'withdrawal' || transaction.type === 'account-adjustment' && transaction.direction === 'debit' ? '↑' : '↗'}</span>
      <span class="activity-copy"><b>${esc(translateText(title, language))}</b><small>${esc(context ? `${translateText(context, language)} · ` : '')}${esc(translateText(status, language))} · ${timestampDateTime(transaction.date)}</small></span>
      <b class="activity-amount ${movementAmount(transaction).startsWith('+') ? 'movement-credit' : movementAmount(transaction).startsWith('−') ? 'movement-debit' : ''}">${movementAmount(transaction)}</b><span class="movement-expand" aria-hidden="true">⌄</span>
    </summary>
    <div class="movement-details">${detailRows.map(([label, value]) =>
      `<div><span>${esc(translateText(label, language))}</span><b>${esc(value)}</b></div>`,
    ).join('')}</div>
  </details>`;
}

function renderPointActivity(entry) {
  return `<article class="points-row">
    <span><b>${esc(translateText(entry.label, language))}</b><small>Bonus points · ${timestampDate(entry.date)}</small></span>
    <b class="points-delta ${entry.amount < 0 ? 'spent' : ''}">${entry.amount > 0 ? '+' : ''}${entry.amount.toLocaleString(LANGUAGE_LOCALES[language])}</b>
  </article>`;
}

function renderAccountRequestHistory(account) {
  const history = [
    ...(account.depositRequests || [])
      .filter((request) => request.status !== 'pending')
      .map((request) => ({ type: 'Deposit', request })),
    ...(account.withdrawalRequests || [])
      .filter((request) => request.status !== 'pending')
      .map((request) => ({ type: 'Withdrawal', request })),
  ];
  if (account.reviewedAt && ['approved', 'rejected'].includes(account.status)) {
    history.push({
      type: 'Account registration',
      request: {
        id: `account-${account.id}`,
        amount: null,
        status: account.status,
        createdAt: account.createdAt,
        reviewedAt: account.reviewedAt,
      },
    });
  }
  history.sort((a, b) => (b.request.reviewedAt || b.request.createdAt || 0) -
    (a.request.reviewedAt || a.request.createdAt || 0));

  return `<details class="account-history">
    <summary>Request history <span>${history.length}</span></summary>
    ${history.length ? `<div class="account-history-list">${history.map(({ type, request }) => {
      const status = {
        confirmed: 'Confirmed',
        completed: 'Paid',
        rejected: 'Rejected',
        approved: 'Approved',
      }[request.status] || request.status;
      const reference = request.txHash || request.address;
      return `<article class="account-history-row">
        <div><b>${esc(type)}${request.amount === null ? '' : ` · ${usd(request.amount)}`}</b><span class="history-status">${esc(status)}</span></div>
        <small>Submitted ${timestampDate(request.createdAt)} · Reviewed ${timestampDate(request.reviewedAt || request.createdAt)}</small>
        ${request.network ? `<small>${esc(NETWORKS[request.network] || request.network)}</small>` : ''}
        ${reference ? `<code>${esc(reference)}</code>` : ''}
        ${request.payoutHash ? `<small>External payout hash</small><code>${esc(request.payoutHash)}</code>` : ''}
      </article>`;
    }).join('')}</div>` : '<p class="account-history-empty">No reviewed requests.</p>'}
  </details>`;
}

function renderAdmin() {
  if (!current || current.role !== 'admin') return;
  const pendingWalletChanges = accounts.flatMap((account) =>
    (account.walletChangeRequests || [])
      .filter((request) => request.status === 'pending')
      .map((request) => ({ account, request })),
  );
  $('pending-wallet-count').textContent = pendingWalletChanges.length;
  $('wallet-queue-empty').hidden = pendingWalletChanges.length > 0;
  $('pending-wallet-changes').innerHTML = pendingWalletChanges.map(({ account, request }) => `
    <article class="queue-card">
      <div class="queue-card-head"><div><b>${esc(account.username)}</b><span>${esc(account.email)}</span></div><span class="queue-status">Pending</span></div>
      <small>Current: ${esc(NETWORKS[request.previousNetwork] || request.previousNetwork)} · ${esc(request.previousAddress)}</small>
      <small>Requested: ${esc(NETWORKS[request.network] || request.network)} · ${esc(request.address)}</small>
      <div class="queue-actions"><button class="approve-button" type="button" data-admin-action="approve-wallet-change" data-user="${esc(account.id)}" data-request="${esc(request.id)}">Approve change</button><button class="reject-button" type="button" data-admin-action="reject-wallet-change" data-user="${esc(account.id)}" data-request="${esc(request.id)}">Reject</button></div>
    </article>`).join('');

  const pendingUsers = accounts.filter((account) => account.status === 'pending');
  const pendingDeposits = accounts.flatMap((account) =>
    (account.depositRequests || [])
      .filter((request) => request.status === 'pending')
      .map((request) => ({ account, request })),
  );
  const pendingWithdrawals = accounts.flatMap((account) =>
    (account.withdrawalRequests || [])
      .filter((request) => request.status === 'pending')
      .map((request) => ({ account, request })),
  );
  $('pending-user-count').textContent = pendingUsers.length;
  $('registered-user-count').textContent = accounts.length;
  $('pending-deposit-count').textContent = pendingDeposits.length;
  $('pending-withdrawal-count').textContent = pendingWithdrawals.length;
  $('users-queue-empty').hidden = pendingUsers.length > 0;
  $('deposits-queue-empty').hidden = pendingDeposits.length > 0;
  $('withdrawals-queue-empty').hidden = pendingWithdrawals.length > 0;
  $('registered-users').innerHTML = accounts.map((account) => `
    <article class="queue-card account-admin-card" data-account-card="${esc(account.id)}">
      <div class="queue-card-head"><div><b>${esc(account.username)}</b><span>${esc(account.email)}</span></div><span class="queue-status ${account.status === 'blocked' ? 'blocked' : ''}">${account.status === 'blocked' ? 'Blocked' : esc(account.status)}</span></div>
      <small>ID ${esc(account.id)} · Registered ${timestampDate(account.createdAt)} · ${account.role === 'admin' ? 'Admin' : 'User'} · ${(account.h9Points || 0).toLocaleString(LANGUAGE_LOCALES[language])} bonus points · ${(account.bonusSpins || 0).toLocaleString(LANGUAGE_LOCALES[language])} extra spins · ${(account.investments || []).length} investments</small>
      <div class="account-balance-fields">
        <label>Deposit balance (USDT)<input type="number" min="0" step="0.01" data-balance="deposit" value="${Number(account.wallet?.deposit || 0)}"></label>
        <label>Earnings balance (USDT)<input type="number" min="0" step="0.01" data-balance="earnings" value="${Number(account.wallet?.earnings || 0)}"></label>
      </div>
      <div class="account-credit-fields">
        <label>Points to add<input type="number" min="0" step="1" inputmode="numeric" data-credit="points" placeholder="0"></label>
        <label>Extra spins to add<input type="number" min="0" step="1" inputmode="numeric" data-credit="spins" placeholder="0"></label>
      </div>
      <div class="queue-actions">
        <button class="approve-button" type="button" data-admin-action="save-account" data-user="${esc(account.id)}">Save balances</button>
        <button class="reject-button" type="button" data-admin-action="toggle-account" data-user="${esc(account.id)}" ${account.id === current.id ? 'disabled' : ''}>${account.status === 'blocked' ? 'Unblock account' : 'Block account'}</button>
      </div>
      ${renderAccountRequestHistory(account)}
      <button class="outline-wide credit-rewards-button" type="button" data-admin-action="credit-rewards" data-user="${esc(account.id)}">Credit points / spins</button>
    </article>`).join('');

  $('pending-users').innerHTML = pendingUsers.map((account) => `
    <article class="queue-card">
      <div class="queue-card-head"><div><b>${esc(account.username)}</b><span>${esc(account.email)}</span></div><span class="queue-status">Pending approval</span></div>
      <small>Registered ${timestampDate(account.createdAt)}</small>
      <div class="queue-actions"><button class="approve-button" type="button" data-admin-action="approve-account" data-user="${esc(account.id)}">Approve account</button><button class="reject-button" type="button" data-admin-action="reject-account" data-user="${esc(account.id)}">Reject</button></div>
    </article>`).join('');

  $('pending-deposits').innerHTML = pendingDeposits.map(({ account, request }) => `
    <article class="queue-card">
      <div class="queue-card-head"><div><b>${esc(account.username)} · ${usd(request.amount)}</b><span>${esc(account.email)}</span></div><span class="queue-status">Pending</span></div>
      <small>${esc(NETWORKS[request.network] || request.network)} · ${timestampDate(request.createdAt)}</small>
      <code class="queue-hash">${esc(request.txHash)}</code>
      <div class="queue-actions"><button class="approve-button" type="button" data-admin-action="confirm-deposit" data-user="${esc(account.id)}" data-request="${esc(request.id)}">Confirm deposit</button><button class="reject-button" type="button" data-admin-action="reject-deposit" data-user="${esc(account.id)}" data-request="${esc(request.id)}">Reject</button></div>
    </article>`).join('');

  $('pending-withdrawals').innerHTML = pendingWithdrawals.map(({ account, request }) => `
    <article class="queue-card" data-withdrawal-card="${esc(request.id)}">
      <div class="queue-card-head"><div><b>${esc(account.username)} · ${usd(request.amount)}</b><span>${esc(account.email)}</span></div><span class="queue-status">Pending</span></div>
      <small>${esc(NETWORKS[request.network] || request.network)} · ${timestampDate(request.createdAt)}</small>
      <code class="queue-hash">${esc(request.address)}</code>
      <label class="queue-input-label" for="payout-${esc(request.id)}">External payout hash</label>
      <input class="queue-input" id="payout-${esc(request.id)}" type="text" placeholder="Transaction hash">
      <div class="queue-actions"><button class="approve-button" type="button" data-admin-action="complete-withdrawal" data-user="${esc(account.id)}" data-request="${esc(request.id)}">Mark paid</button><button class="reject-button" type="button" data-admin-action="reject-withdrawal" data-user="${esc(account.id)}" data-request="${esc(request.id)}">Reject and refund</button></div>
    </article>`).join('');
}

function refreshDepositAddressDisplay() {
  const network = $('deposit-network')?.value;
  const address = depositAddresses[network] || '';
  const value = $('deposit-address-value');
  if (!value) return;
  value.textContent = address || translateText('Address not configured for this network.', language);
  $('deposit-address-box').classList.toggle('unconfigured', !address);
  $('copy-deposit-address').disabled = !address;
}

function renderDailyPrizeOdds() {
  const colors = ['#91d85a', '#68b95d', '#46a579', '#42988e', '#70c994', '#a8e275', '#8cce64', '#5fae78', '#b7e983'];
  const sliceAngle = 360 / DAILY_PRIZES.length;
  const stops = DAILY_PRIZES.map((prize, index) =>
    `${colors[index]} ${index * sliceAngle}deg ${(index + 1) * sliceAngle}deg`,
  );
  $('mystery-wheel').style.background = `conic-gradient(${stops.join(',')})`;
  $('daily-prize-odds').innerHTML = DAILY_PRIZES.map((prize, index) =>
    `<div class="odds-row"><span class="prize-label"><i class="prize-dot" style="--prize-color:${colors[index]}"></i>${prize.points.toLocaleString(LANGUAGE_LOCALES[language])} bonus points</span></div>`,
  ).join('');
}

function updateSpinButton() {
  const today = new Date().toISOString().slice(0, 10);
  const usedDailySpin = current.lastDailyPrizeDate === today;
  const extraSpins = current.bonusSpins || 0;
  $('spin-wheel').disabled = wheelSpinning || (usedDailySpin && extraSpins === 0);
  $('spin-wheel').textContent = usedDailySpin
    ? (extraSpins > 0 ? `${translateText('Use extra spin', language)} · ${extraSpins}` : translateText('Come back tomorrow', language))
    : translateText('Open today’s mystery box', language);
}

function renderRewards() {
  const today = new Date().toISOString().slice(0, 10);
  const inviteUrl = new URL(location.href);
  inviteUrl.hash = '';
  inviteUrl.searchParams.set('ref', current.referralCode || '');
  $('invite-link').value = inviteUrl.href;
  $('h9-points').textContent = (current.h9Points || 0).toLocaleString(LANGUAGE_LOCALES[language]);
  $('extra-spin-count').textContent = (current.bonusSpins || 0).toLocaleString(LANGUAGE_LOCALES[language]);
  $('referral-count').textContent = (current.referrals || []).length.toLocaleString(LANGUAGE_LOCALES[language]);
  updateSpinButton();
  const todaysPrize = (current.dailyPrizes || []).find((prize) =>
    new Date(prize.date).toISOString().slice(0, 10) === today,
  );
  $('wheel-result').textContent = todaysPrize
    ? `${translateText('Today’s prize', language)}: ${todaysPrize.points.toLocaleString(LANGUAGE_LOCALES[language])} bonus points`
    : 'Open one mystery box each day.';
  $('reward-catalog').innerHTML = REWARDS.map((reward) => {
    const detail = reward.type === 'boost'
      ? `${translateText('Double calculated earnings on active plans for', language)} ${reward.hours} ${translateText(reward.hours === 1 ? 'hour' : 'hours', language)}.`
      : `${translateText('Redeem for', language)} ${usd(reward.amount)} ${translateText('in your account deposit balance. Credits cannot be transferred or paid out.', language)}`;
    return `<article class="reward-card">
      <h3>${esc(translateText(reward.title, language))}</h3><p>${esc(detail)}</p>
      <span class="reward-cost">${reward.points.toLocaleString(LANGUAGE_LOCALES[language])} bonus points</span>
      <button class="primary-button" type="button" data-buy-reward="${esc(reward.id)}">${translateText('Redeem', language)}</button>
    </article>`;
  }).join('');

  const activeBonuses = (current.activeBonuses || [])
    .filter((bonus) => bonus.expiresAt > Date.now());
  const redemptions = current.rewardRedemptions || [];
  const benefitRows = [
    ...activeBonuses.map((bonus) => {
      const remainingHours = Math.max(1, Math.ceil((bonus.expiresAt - Date.now()) / 3_600_000));
      return `<article class="reward-row"><span><b>${esc(translateText(bonus.title, language))}</b><small>${translateText('Ends', language)} ${timestampDate(bonus.expiresAt)}</small></span><span class="reward-state">2× · ${remainingHours}${translateText('h left', language)}</span></article>`;
    }),
    ...redemptions.map((coupon) =>
      `<article class="reward-row"><span><b>${esc(translateText(coupon.title, language))}</b><small>${translateText('Redeemed', language)} ${timestampDate(coupon.creditedAt || coupon.requestedAt)} · ${translateText(coupon.balanceDestination === 'deposit' ? 'added to account deposit balance' : 'added to account earnings', language)}</small></span><span class="reward-state">${translateText('Credited', language)}</span></article>`,
    ),
  ];
  $('active-rewards').innerHTML = benefitRows.join('');
  $('active-rewards-empty').hidden = benefitRows.length > 0;

  $('points-history').innerHTML = (current.pointHistory || []).map((entry) => `
    <article class="points-row">
      <span><b>${esc(translateText(entry.label, language))}</b><small>${timestampDate(entry.date)}</small></span>
      <b class="points-delta ${entry.amount < 0 ? 'spent' : ''}">${entry.amount > 0 ? '+' : ''}${entry.amount.toLocaleString(LANGUAGE_LOCALES[language])}</b>
    </article>`).join('');
  $('points-history-empty').hidden = (current.pointHistory || []).length > 0;
  renderDailyPrizeOdds();
}

function renderFullHistory() {
  const entries = [...(current.transactions || [])];
  const recordedRefunds = new Set(entries
    .filter((entry) => entry.type === 'withdrawal-refund')
    .map((entry) => entry.requestId));
  for (const request of current.withdrawalRequests || []) {
    if (request.status !== 'rejected' || !request.reviewedAt || recordedRefunds.has(request.id)) continue;
    entries.push({
      id: `refund-${request.id}`,
      type: 'withdrawal-refund',
      amount: request.amount,
      status: 'completed',
      date: request.reviewedAt,
      network: request.network,
      requestId: request.id,
      planName: 'Withdrawal request refund',
    });
  }
  entries.sort((a, b) => (b.date || 0) - (a.date || 0));
  const categories = [
    ['all', 'All movements'],
    ['deposits', 'Deposits'],
    ['credits', 'Credits'],
    ['withdrawals', 'Withdrawals'],
    ['investments', 'Investments'],
    ['other', 'Other'],
  ];
  $('history-filters').innerHTML = categories.map(([key, label]) => {
    const count = key === 'all' ? entries.length : entries.filter((entry) => movementCategory(entry) === key).length;
    return `<button class="history-filter${selectedHistoryFilter === key ? ' active' : ''}" type="button" data-history-filter="${key}" aria-pressed="${selectedHistoryFilter === key}">${esc(translateText(label, language))}<span>${count}</span></button>`;
  }).join('');
  const visibleEntries = selectedHistoryFilter === 'all'
    ? entries
    : entries.filter((entry) => movementCategory(entry) === selectedHistoryFilter);
  $('profile-activity').innerHTML = visibleEntries.map(renderMovement).join('');
  $('profile-activity-empty').hidden = visibleEntries.length > 0;
  $('profile-activity-empty').querySelector('b').textContent = translateText(
    entries.length ? 'No movements in this category' : 'No transactions yet', language,
  );
}

function render() {
  if (!current) return;
  const wallet = current.wallet;
  const locked = current.investments
    .filter((investment) => investment.status === 'active')
    .reduce((sum, investment) => sum + (Number(investment.marketValue) || investment.principal), 0);
  $('user-chip').textContent = current.username;
  $('profile-username').textContent = current.username;
  $('profile-email').textContent = current.email;
  if ($('admin-new-email') && document.activeElement !== $('admin-new-email')) {
    $('admin-new-email').value = current.email;
  }
  $('profile-account-id').textContent = current.id;
  $('profile-avatar').textContent = [...current.username][0].toLocaleUpperCase('it-IT');
  language = LANGUAGES.includes(current.preferences?.language) ? current.preferences.language : 'en';
  $('language-select').value = language;
  $('theme-select').value = current.preferences?.theme || 'dark';
  document.documentElement.lang = language;
  document.documentElement.dataset.theme = $('theme-select').value;
  const linkedWallet = current.withdrawalWallet;
  const pendingWalletChange = (current.walletChangeRequests || []).some((request) => request.status === 'pending');
  $('bound-wallet-label').textContent = pendingWalletChange
    ? 'Wallet change awaiting admin approval'
    : linkedWallet?.address ? `${NETWORKS[linkedWallet.network] || linkedWallet.network} · ${linkedWallet.address.slice(0, 8)}…${linkedWallet.address.slice(-5)}` : 'No wallet linked';
  $('edit-wallet-button').textContent = linkedWallet ? 'Request change' : 'Link wallet';
  $('edit-wallet-button').disabled = pendingWalletChange;
  $('wallet-title').textContent = linkedWallet ? 'Request wallet change' : 'Link a withdrawal wallet';
  $('save-wallet-button').textContent = linkedWallet ? 'Request admin approval' : 'Save wallet';
  $('withdrawal-pin-status').textContent = current.withdrawalPinSet ? 'Set' : 'Not set';
  $('edit-withdrawal-pin-button').textContent = current.withdrawalPinSet ? 'Change PIN' : 'Set PIN';
  $('wallet-network').value = linkedWallet?.network || 'bep20';
  $('wallet-address').value = linkedWallet?.address || '';
  $('withdraw-address').value = linkedWallet?.address || '';
  $('withdraw-network').value = linkedWallet?.network || 'bep20';
  $('withdraw-network').disabled = Boolean(linkedWallet);
  $('open-admin').hidden = current.role !== 'admin';
  $('reset-account-data').hidden = current.role !== 'admin';
  $('total-balance').textContent = usd(balanceTotal());
  $('deposit-balance').textContent = usd(wallet.deposit);
  $('earnings-balance').textContent = usd(wallet.earnings);
  $('locked-balance').textContent = usd(locked);
  $('reinvested-balance').textContent = usd(redeemableEarnings());
  document.querySelectorAll('[data-redeem-earnings]').forEach((button) => {
    button.disabled = redeemableEarnings() <= 0;
    const label = `${translateText('Redeem profits', language)} · ${usd(redeemableEarnings())}`;
    (button.querySelector('b') || button).textContent = label;
  });
  $('profile-deposit').textContent = usd(wallet.deposit);
  $('profile-earnings').textContent = usd(wallet.earnings);
  $('withdraw-available').textContent = usd(wallet.earnings);
  $('invest-available').textContent = usd(wallet.deposit);

  const active = current.investments.filter((investment) => investment.status === 'active');
  const ended = current.investments.filter((investment) => investment.status === 'matured');
  $('home-investments').innerHTML = active.slice(0, 3).map((investment) => renderInvestment(investment)).join('');
  $('home-investments-empty').hidden = active.length > 0;
  $('active-investments').innerHTML = active.map((investment) => renderInvestment(investment)).join('');
  $('active-empty').hidden = active.length > 0;
  $('ended-investments').innerHTML = ended.map((investment) => renderInvestment(investment, true)).join('');
  $('ended-empty').hidden = ended.length > 0;
  $('locked-total').textContent = usd(locked);
  $('credited-total').textContent = usd(redeemableEarnings());

  const transactions = current.transactions.slice(0, 8);
  $('recent-activity').innerHTML = transactions.map(renderActivity).join('');
  $('activity-empty').hidden = transactions.length > 0;
  renderFullHistory();
  const notificationsSeenAt = current.preferences?.notificationsSeenAt || 0;
  let earningsNotice = readEarningsNoticeState();
  const unreadEarnings = current.transactions.filter((item) =>
    item.type === 'earnings' && (item.date || 0) > notificationsSeenAt,
  );
  if (unreadEarnings.length &&
      Date.now() - (Number(earningsNotice.shownAt) || 0) >= DAY_MS) {
    earningsNotice = {
      shownAt: Date.now(),
      ids: unreadEarnings.map((item) => item.id),
    };
    localStorage.setItem(earningsNoticeKey(), JSON.stringify(earningsNotice));
  }
  const surfacedEarnings = new Set(Array.isArray(earningsNotice.ids) ? earningsNotice.ids : []);
  const notificationTransactions = current.transactions.filter((item) =>
    item.type !== 'compounding' && (item.type !== 'earnings' || surfacedEarnings.has(item.id)),
  );
  const unreadNotifications = notificationTransactions
    .filter((item) => (item.date || 0) > notificationsSeenAt)
    .slice(0, 12);
  $('notification-list').innerHTML = unreadNotifications.map(renderActivity).join('');
  $('notifications-empty').hidden = unreadNotifications.length > 0;
  const latestNonEarningAt = current.transactions
    .filter((item) => item.type !== 'earnings' && item.type !== 'compounding')
    .reduce((latest, item) => Math.max(latest, item.date || 0), 0);
  const latestActivityAt = Math.max(
    latestNonEarningAt,
    surfacedEarnings.size ? Number(earningsNotice.shownAt) || 0 : 0,
  );
  $('notification-dot').hidden = latestActivityAt <= notificationsSeenAt;
  renderRewards();
  $('home-plans').innerHTML = PLANS.map((plan) => renderPlan(plan, true)).join('');
  $('catalog-plans').innerHTML = PLANS.map((plan) => renderPlan(plan)).join('');
  renderAssetHistoryChart();
  renderCustomPlan();
  renderAdmin();
  translatePage(language);
}

function setView(name) {
  if (name === 'admin' && current?.role !== 'admin') return;
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  document.querySelectorAll('.nav-item').forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function adminAction(action, accountId, requestId, card) {
  if (!current || current.role !== 'admin') return;
  const target = accounts.find((account) => account.id === accountId);
  if (!target) return;
  if (action === 'credit-rewards') {
    const accountCard = document.querySelector(`[data-account-card="${CSS.escape(accountId)}"]`);
    const points = Number(accountCard?.querySelector('[data-credit="points"]')?.value || 0);
    const spins = Number(accountCard?.querySelector('[data-credit="spins"]')?.value || 0);
    if (!Number.isSafeInteger(points) || points < 0 ||
        !Number.isSafeInteger(spins) || spins < 0 || (points === 0 && spins === 0)) {
      toast('Enter a positive whole number of points or extra spins.');
      return;
    }
    try {
      const { account } = await apiRequest('/api/admin/rewards/credit', {
        method: 'POST',
        body: JSON.stringify({ accountId, points, spins }),
      });
      const index = accounts.findIndex((item) => item.id === account.id);
      if (index >= 0) accounts[index] = account;
      if (current.id === account.id) current = account;
      render();
      toast('Points and extra spins credited.');
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  if (action === 'approve-wallet-change' || action === 'reject-wallet-change') {
    try {
      const { account } = await apiRequest('/api/admin/wallet-change', {
        method: 'POST',
        body: JSON.stringify({
          accountId,
          requestId,
          decision: action === 'approve-wallet-change' ? 'approve' : 'reject',
        }),
      });
      const index = accounts.findIndex((item) => item.id === account.id);
      if (index >= 0) accounts[index] = account;
      if (current.id === account.id) current = account;
      render();
      toast(action === 'approve-wallet-change' ? 'Wallet change approved.' : 'Wallet change rejected.');
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const before = JSON.stringify(accounts);
  let message = '';
  if (action === 'save-account') {
    const accountCard = document.querySelector(`[data-account-card="${CSS.escape(accountId)}"]`);
    const deposit = Number(accountCard?.querySelector('[data-balance="deposit"]')?.value);
    const earnings = Number(accountCard?.querySelector('[data-balance="earnings"]')?.value);
    if (!Number.isFinite(deposit) || !Number.isFinite(earnings) || deposit < 0 || earnings < 0) {
      toast('Enter valid non-negative balances.');
      return;
    }
    const previousWallet = target.wallet || { deposit: 0, earnings: 0 };
    const balanceChanges = [
      ['deposit', Number(previousWallet.deposit) || 0, deposit],
      ['earnings', Number(previousWallet.earnings) || 0, earnings],
    ].filter(([, previous, next]) => previous !== next);
    const adjustedAt = Date.now();
    target.transactions ||= [];
    for (const [balanceType, previousBalance, newBalance] of balanceChanges) {
      target.transactions.unshift({
        id: crypto.randomUUID?.() || `${adjustedAt}-${Math.random().toString(36).slice(2)}`,
        type: 'account-adjustment',
        amount: Math.abs(newBalance - previousBalance),
        direction: newBalance > previousBalance ? 'credit' : 'debit',
        balanceType,
        previousBalance,
        newBalance,
        status: 'completed',
        date: adjustedAt,
        planName: 'Administrator balance adjustment',
      });
    }
    target.wallet = { ...target.wallet, deposit, earnings };
    message = `Balances updated for ${target.username}.`;
  } else if (action === 'toggle-account' && target.id !== current.id) {
    target.status = target.status === 'blocked' ? 'approved' : 'blocked';
    message = target.status === 'blocked'
      ? `Account ${target.username} blocked.`
      : `Account ${target.username} unblocked.`;
  } else if (action === 'approve-account' && target.status === 'pending') {
    target.status = 'approved';
    target.approvedAt = Date.now();
    target.reviewedAt = target.approvedAt;
    message = `Account ${target.username} approved.`;
  } else if (action === 'reject-account' && target.status === 'pending') {
    target.status = 'rejected';
    target.reviewedAt = Date.now();
    message = `Account ${target.username} rejected.`;
  } else if (action === 'confirm-deposit') {
    const request = target.depositRequests.find((item) => item.id === requestId && item.status === 'pending');
    if (!request) return;
    request.status = 'confirmed';
    request.reviewedAt = Date.now();
    target.wallet.deposit += request.amount;
    const transaction = target.transactions.find((item) => item.id === request.transactionId);
    if (transaction) transaction.status = 'confirmed';
    message = `Deposit request of ${usd(request.amount)} confirmed.`;
  } else if (action === 'reject-deposit') {
    const request = target.depositRequests.find((item) => item.id === requestId && item.status === 'pending');
    if (!request) return;
    request.status = 'rejected';
    request.reviewedAt = Date.now();
    const transaction = target.transactions.find((item) => item.id === request.transactionId);
    if (transaction) transaction.status = 'rejected';
    message = 'Deposit request rejected.';
  } else if (action === 'complete-withdrawal') {
    const request = target.withdrawalRequests.find((item) => item.id === requestId && item.status === 'pending');
    const payoutHash = card.querySelector('.queue-input')?.value.trim();
    if (!request || !payoutHash) {
      toast('Enter the payout transaction hash before marking this withdrawal as paid.');
      return;
    }
    request.status = 'completed';
    request.payoutHash = payoutHash;
    request.reviewedAt = Date.now();
    const transaction = target.transactions.find((item) => item.id === request.transactionId);
    if (transaction) transaction.status = 'completed';
    message = 'Withdrawal marked as paid.';
  } else if (action === 'reject-withdrawal') {
    const request = target.withdrawalRequests.find((item) => item.id === requestId && item.status === 'pending');
    if (!request) return;
    request.status = 'rejected';
    request.reviewedAt = Date.now();
    target.wallet.earnings += request.amount;
    target.transactions.unshift({
      id: crypto.randomUUID?.() || `${request.reviewedAt}-${Math.random().toString(36).slice(2)}`,
      type: 'withdrawal-refund',
      amount: request.amount,
      status: 'completed',
      date: request.reviewedAt,
      network: request.network,
      requestId: request.id,
      planName: 'Withdrawal request refund',
    });
    const transaction = target.transactions.find((item) => item.id === request.transactionId);
    if (transaction) transaction.status = 'rejected';
    message = `Request rejected; ${usd(request.amount)} returned to your earnings balance.`;
  }
  if (!message) return;
  if (!await saveAccounts(target)) {
    accounts = JSON.parse(before);
    current = accounts.find((account) => account.id === current.id) || current;
    render();
    return;
  }
  current = accounts.find((account) => account.id === current.id) || current;
  render();
  toast(message);
}

function openPlan(id) {
  selectedPlan = PLANS.find((plan) => plan.id === id);
  if (!selectedPlan) return;
  $('plan-dialog-title').textContent = selectedPlan.name;
  const term = selectedPlan.months === 6 ? '6 months' : selectedPlan.months === 12 ? '1 year' : (selectedPlan.months / 12) + ' years';
  $('plan-terms').textContent = `${translateText(term, language)} · ${translateText('Market-linked contract. No fixed daily return.', language)} · ${translateText('Capital protection', language)} -20%.`;
  $('invest-amount').value = '';
  setError('plan-error');
  $('plan-dialog').showModal();
}

async function registerAccount(event) {
  event.preventDefault();
  setError('register-error');
  const submitButton = event.currentTarget.querySelector('[type="submit"]');
  if (submitButton.disabled) return;
  const username = $('register-username').value.trim();
  const email = $('register-email').value.trim().toLowerCase();
  const password = $('register-password').value;
  if (password !== $('register-confirm').value) {
    setError('register-error', 'Passwords do not match.');
    return;
  }
  submitButton.disabled = true;
  try {
  const result = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, language, referralCode: $('register-referral').value.trim() }),
    });
    accessToken = result.token;
    sessionStorage.setItem(SESSION_KEY, accessToken);
    accounts = [result.account];
    $('register-form').reset();
    openApp(result.account);
    toast('Your account is ready.');
  } catch (error) {
    setError('register-error', error.message);
    return;
  } finally {
    submitButton.disabled = false;
  }
}

async function showRecoveryKey(code, email) {
  $('recovery-key-value').value = code;
  let project = null;
  try {
    project = await window.websim?.getCurrentProject?.();
  } catch {}
  const baseUrl = project?.id
    ? 'https://websim.com/p/' + encodeURIComponent(project.id)
    : new URL(location.pathname, location.origin).href;
  const recoveryUrl = new URL(baseUrl);
  recoveryUrl.hash = 'recover?' + new URLSearchParams({ email, key: code });
  $('recovery-link-value').value = recoveryUrl.href;
  $('recovery-key-dialog').showModal();
}

function showPasswordRecovery(mode) {
  $('landing').hidden = true;
  $('auth-screen').hidden = false;
  $('auth-entry').hidden = false;
  $('auth-switch').hidden = true;
  $('login-form').hidden = true;
  $('register-form').hidden = true;
  $('forgot-password-button').hidden = true;
  $('password-reset-request-form').hidden = mode !== 'request';
  $('password-reset-form').hidden = mode !== 'confirm';
  $('auth-title').textContent = mode === 'request' ? 'Reset password' : 'Set a new password';
  $('auth-subtitle').textContent = '';
  translatePage(language);
}

async function requestPasswordReset(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  const email = $('reset-email').value.trim().toLowerCase();
  button.disabled = true;
  $('reset-request-message').textContent = '';
  try {
    const result = await apiRequest('/api/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email, recoveryCode: $('reset-recovery-key').value }),
    });
    pendingPasswordResetToken = result.token;
    $('reset-request-message').textContent = translateText(
      'Recovery key verified. Choose a new password.', language,
    );
    $('reset-request-message').classList.add('success');
    showPasswordRecovery('confirm');
  } catch (error) {
    $('reset-request-message').textContent = translateText(error.message, language);
    $('reset-request-message').classList.remove('success');
  } finally {
    button.disabled = false;
  }
}

async function confirmPasswordReset(event) {
  event.preventDefault();
  setError('reset-password-error');
  const password = $('reset-new-password').value;
  if (password !== $('reset-confirm-password').value) {
    setError('reset-password-error', 'New passwords do not match.');
    return;
  }
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await apiRequest('/api/auth/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify({
        token: pendingPasswordResetToken || new URLSearchParams(location.search).get('reset') || '',
        password,
      }),
    });
    $('password-reset-form').reset();
    $('password-reset-request-form').reset();
    pendingPasswordResetToken = '';
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete('reset');
    history.replaceState(null, '', cleanUrl);
    showAuthMode('login');
    setError('login-error', 'Your password has been updated. You can now log in.');
    $('login-error').classList.add('success');
  } catch (error) {
    setError('reset-password-error', error.message);
  } finally {
    button.disabled = false;
  }
}

async function login(event) {
  event.preventDefault();
  setError('login-error');
  const submitButton = event.currentTarget.querySelector('[type="submit"]');
  if (submitButton.disabled) return;
  submitButton.disabled = true;
  const email = $('login-email').value.trim().toLowerCase();
  const password = $('login-password').value;
  try {
    const result = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    accessToken = result.token;
    sessionStorage.setItem(SESSION_KEY, accessToken);
    accounts = [result.account];
    openApp(result.account);
  } catch (error) {
    setError('login-error', error.message);
    return;
  } finally {
    submitButton.disabled = false;
  }
}

async function updateAdminCredentials(event) {
  event.preventDefault();
  if (!current || current.role !== 'admin') return;
  setError('admin-credentials-error');
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const currentPassword = $('admin-current-password').value;
  const newEmail = $('admin-new-email').value.trim().toLowerCase();
  const newPassword = $('admin-new-password').value;
  if (newPassword !== $('admin-confirm-password').value) {
    setError('admin-credentials-error', 'New passwords do not match.');
    return;
  }
  button.disabled = true;
  try {
    const result = await apiRequest('/api/admin/credentials', {
      method: 'PUT',
      body: JSON.stringify({
        currentEmail: current.email, currentPassword, newEmail, newPassword,
      }),
    });
    if (result.token) {
      accessToken = result.token;
      sessionStorage.setItem(SESSION_KEY, accessToken);
    }
    current.email = result.email || result.account?.email || newEmail;
    $('profile-email').textContent = current.email;
    form.reset();
    $('admin-new-email').value = current.email;
    toast(result.message || 'Admin credentials updated.');
  } catch (error) {
    setError('admin-credentials-error', error.message);
  } finally {
    button.disabled = false;
  }
}

async function addDeposit(event) {
  event.preventDefault();
  setError('deposit-error');
  const amount = Number($('deposit-amount').value);
  const txHash = $('deposit-txhash').value.trim();
  if (!Number.isFinite(amount) || amount <= 0) {
    setError('deposit-error', 'Enter a valid amount.');
    return;
  }
  if (!txHash) {
    setError('deposit-error', 'Enter the transaction hash for review.');
    return;
  }
  if (!depositAddresses[$('deposit-network').value]) {
    setError('deposit-error', 'Deposit address is not configured for this network.');
    return;
  }
  try {
    const network = $('deposit-network').value;
    const result = await apiRequest('/api/deposits', {
      method: 'POST',
      body: JSON.stringify({ amount, network, txHash, depositAddress: depositAddresses[network] }),
    });
    applyAccount(result.account);
    $('deposit-dialog').close();
    $('deposit-form').reset();
    toast('Request submitted for admin review.');
  } catch (error) {
    setError('deposit-error', error.message);
    return;
  }
}

async function addWithdrawal(event) {
  event.preventDefault();
  setError('withdraw-error');
  const amount = Number($('withdraw-amount').value);
  const address = $('withdraw-address').value.trim();
  const pin = $('withdrawal-pin').value;
  if (!Number.isFinite(amount) || amount <= 0 || amount > current.wallet.earnings) {
    setError('withdraw-error', `Enter a valid amount. Available: ${usd(current.wallet.earnings)}.`);
    return;
  }
  if (!address) {
    setError('withdraw-error', 'Enter a destination address.');
    return;
  }
  if (!/^\d{6}$/.test(pin)) {
    setError('withdraw-error', 'Enter your six-digit withdrawal password.');
    return;
  }
  try {
    const result = await apiRequest('/api/withdrawals', {
      method: 'POST',
      body: JSON.stringify({ amount, network: $('withdraw-network').value, address, pin }),
    });
    applyAccount(result.account);
    $('withdraw-dialog').close();
    $('withdraw-form').reset();
    toast('Withdrawal request submitted for review. No payout is sent.');
  } catch (error) {
    setError('withdraw-error', error.message);
    return;
  }
}

async function redeemInvestmentEarnings(button, investmentId = '') {
  if (!current || button.disabled) return;
  button.disabled = true;
  try {
    const { account, amount } = await apiRequest('/api/earnings/redeem', {
      method: 'POST',
      body: JSON.stringify({ ...(investmentId ? { investmentId } : {}), quotes: currentMarketQuotes() }),
    });
    applyAccount(account);
    const investment = current.investments.find((item) => item.id === investmentId);
    const label = investment
      ? `${PLANS.find((plan) => plan.id === investment.planId)?.name || 'Investment'} · `
      : '';
    toast(`${label}${usd(amount)} moved to your earnings balance.`);
  } catch (error) {
    toast(error.message);
    render();
  }
}

async function updateAutoRedeemSetting(investmentId, control) {
  if (!current || control.disabled) return;
  const investment = current.investments.find((item) => item.id === investmentId && item.status === 'active');
  if (!investment) return;
  const card = control.closest('.investment-card');
  const checkbox = card.querySelector('[data-auto-redeem]');
  const percentInput = card.querySelector('[data-auto-redeem-percent]');
  const enabled = control === checkbox ? checkbox.checked : investment.autoRedeemEnabled === true;
  const percent = Number(percentInput.value);
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    toast('Choose a percentage between 1 and 100.');
    render();
    return;
  }
  checkbox.disabled = true;
  percentInput.disabled = true;
  try {
    const { account } = await apiRequest('/api/investments/auto-redeem', {
      method: 'POST',
      body: JSON.stringify({ investmentId, enabled, percent }),
    });
    applyAccount(account);
  } catch (error) {
    toast(error.message);
    render();
  }
}

function syncCustomDraftFromForm(form) {
  if (!customDraft || !form) return;
  form.querySelectorAll('[data-custom-field]').forEach((field) => {
    customDraft[field.dataset.customField] = field.value;
  });
  form.querySelectorAll('[data-custom-asset]').forEach((checkbox) => {
    const config = customDraft.allocations[checkbox.dataset.customAsset];
    config.selected = checkbox.checked;
    config.weight = form.querySelector('[data-custom-weight="' + checkbox.dataset.customAsset + '"]').value;
  });
}

async function unlockCustomPlan(button) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const { account } = await apiRequest('/api/custom-plan/subscribe', { method: 'POST' });
    customDraft = null;
    applyAccount(account);
    toast('Custom plan access activated for one year.');
  } catch (error) {
    toast(error.message);
    render();
  }
}

async function startCustomInvestment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $('custom-plan-error');
  error.textContent = '';
  syncCustomDraftFromForm(form);
  const allocations = Object.entries(customDraft.allocations)
    .filter(([, asset]) => asset.selected)
    .map(([name, asset]) => ({ name, weight: Number(asset.weight) }));
  if (Math.abs(allocations.reduce((sum, asset) => sum + asset.weight, 0) - 100) > 0.01) {
    error.textContent = translateText('Selected asset weights must total 100%.', language);
    return;
  }
  const amount = Number(customDraft.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > current.wallet.deposit) {
    error.textContent = translateText('Enter a valid amount within your deposit balance.', language);
    return;
  }
  const button = $('custom-invest-button');
  button.disabled = true;
  try {
    await refreshMarketQuotes();
    const { account } = await apiRequest('/api/investments', {
      method: 'POST',
      body: JSON.stringify({
        planId: 'custom', amount, months: Number(customDraft.months),
        stopLossPercent: Number(customDraft.stopLossPercent),
        autoRedeemPercent: Number(customDraft.autoRedeemPercent),
        allocations, quotes: currentMarketQuotes(),
      }),
    });
    customDraft = null;
    applyAccount(account);
    setView('investments');
    toast('Custom investment activated.');
  } catch (requestError) {
    error.textContent = translateText(requestError.message, language);
    updateCustomAllocationSummary();
  }
}

async function startInvestment(event) {
  event.preventDefault();
  if (!selectedPlan) return;
  setError('plan-error');
  const amount = Number($('invest-amount').value);
  if (!Number.isFinite(amount) || amount <= 0) {
    setError('plan-error', 'Enter an amount greater than zero.');
    return;
  }
  if (amount > current.wallet.deposit) {
    setError('plan-error', 'Insufficient deposit balance. Add funds to continue.');
    return;
  }
  try {
    await refreshMarketQuotes();
    const result = await apiRequest('/api/investments', {
      method: 'POST',
      body: JSON.stringify({ amount, planId: selectedPlan.id, quotes: currentMarketQuotes() }),
    });
    applyAccount(result.account);
  } catch (error) {
    setError('plan-error', error.message);
    return;
  }
  $('plan-dialog').close();
  $('plan-form').reset();
  setView('investments');
  toast('Plan activated. Your capital is now locked.');
}

async function purchaseReward(button) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const { account } = await apiRequest('/api/rewards/purchase', {
      method: 'POST',
      body: JSON.stringify({ rewardId: button.dataset.buyReward }),
    });
    applyAccount(account);
    toast('Reward redeemed with bonus points.');
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  }
}

async function spinDailyWheel() {
  const button = $('spin-wheel');
  if (button.disabled || wheelSpinning) return;
  wheelSpinning = true;
  button.disabled = true;
  try {
    const { account, prize } = await apiRequest('/api/rewards/spin', { method: 'POST' });
    applyAccount(account);
    const prizeIndex = DAILY_PRIZES.findIndex((item) => item.id === prize.id);
    const targetAngle = (prizeIndex + 0.5) * (360 / DAILY_PRIZES.length);
    const finalRotation = 5 * 360 + ((360 - targetAngle) % 360);
    const wheel = $('mystery-wheel');
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    wheel.offsetWidth;
    wheel.style.transition = '';
    wheel.style.transform = `rotate(${finalRotation}deg)`;
    window.setTimeout(() => {
      $('wheel-result').textContent = `${translateText('You won', language)} ${prize.points.toLocaleString(LANGUAGE_LOCALES[language])} bonus points.`;
      wheelSpinning = false;
      updateSpinButton();
      toast('Daily bonus points added to your account.');
    }, 4100);
  } catch (error) {
    wheelSpinning = false;
    updateSpinButton();
    toast(error.message);
  }
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.tab)));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.go)));
document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', async () => {
  const dialog = $(button.dataset.open);
  setError(dialog.id === 'deposit-dialog' ? 'deposit-error' : 'withdraw-error');
  if (dialog.id === 'deposit-dialog') {
    try {
      const { addresses } = await apiRequest('/api/deposit-addresses');
      depositAddresses = addresses || depositAddresses;
      refreshDepositAddressDisplay();
    } catch (error) {
      toast(error.message);
      return;
    }
  }
  if (dialog.id === 'withdraw-dialog') {
    if (!await refreshAccount() || !current) return;
    if (!current.withdrawalWallet) {
      setView('profile');
      $('wallet-dialog').showModal();
      toast('Link a withdrawal wallet before requesting a withdrawal.');
      return;
    }
    if (!current.withdrawalPinSet) {
      setView('profile');
      $('withdrawal-pin-form').reset();
      setError('withdrawal-pin-error');
      $('withdrawal-pin-dialog').showModal();
      toast('Set your withdrawal password before requesting a withdrawal.');
      return;
    }
    $('withdraw-amount').value = '';
    $('withdrawal-pin').value = '';
    $('withdraw-address').value = current.withdrawalWallet?.address || '';
    $('withdraw-network').value = current.withdrawalWallet?.network || 'bep20';
  }
  dialog.showModal();
}));
document.addEventListener('input', (event) => {
  const form = event.target.closest('#custom-plan-form');
  if (!form) return;
  syncCustomDraftFromForm(form);
  updateCustomAllocationSummary();
});
document.addEventListener('change', (event) => {
  const customForm = event.target.closest('#custom-plan-form');
  if (customForm) {
    syncCustomDraftFromForm(customForm);
    const checkbox = event.target.closest('[data-custom-asset]');
    if (checkbox) checkbox.closest('.custom-asset-row').querySelector('[data-custom-weight]').disabled = !checkbox.checked;
    updateCustomAllocationSummary();
  }
  const control = event.target.closest('[data-auto-redeem], [data-auto-redeem-percent]');
  if (control) updateAutoRedeemSetting(control.dataset.autoRedeem || control.dataset.autoRedeemPercent, control);
});
document.addEventListener('submit', (event) => {
  if (event.target.id === 'custom-plan-form') startCustomInvestment(event);
});
document.addEventListener('click', (event) => {
  const unlockButton = event.target.closest('[data-unlock-custom-plan]');
  if (unlockButton) {
    unlockCustomPlan(unlockButton);
    return;
  }
  const teamMemberButton = event.target.closest('[data-team-member]');
  if (teamMemberButton) openTeamMember(teamMemberButton.dataset.teamMember);
  const planButton = event.target.closest('[data-plan-details]');
  const planCard = event.target.closest('[data-plan-card]');
  if (planButton) showPlanDetails(planButton.dataset.planDetails);
  else if (planCard) showPlanDetails(planCard.dataset.planCard);
  const investmentRedeemButton = event.target.closest('[data-redeem-investment]');
  if (investmentRedeemButton) {
    redeemInvestmentEarnings(investmentRedeemButton, investmentRedeemButton.dataset.redeemInvestment);
    return;
  }
  const investmentCard = event.target.closest('[data-investment-detail]');
  if (investmentCard) showInvestmentDetails(investmentCard.dataset.investmentDetail);
  const redeemButton = event.target.closest('[data-redeem-earnings]');
  if (redeemButton) redeemInvestmentEarnings(redeemButton);
  const closeButton = event.target.closest('[data-close]');
  if (closeButton) $(closeButton.dataset.close).close();
  const rewardButton = event.target.closest('[data-buy-reward]');
  if (rewardButton) purchaseReward(rewardButton);
  const adminButton = event.target.closest('[data-admin-action]');
  if (adminButton) {
    const card = adminButton.closest('.queue-card');
    adminAction(
      adminButton.dataset.adminAction,
      adminButton.dataset.user,
      adminButton.dataset.request,
      card,
    );
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const investmentButton = event.target.closest('[data-investment-detail]');
  if (!investmentButton) return;
  event.preventDefault();
  showInvestmentDetails(investmentButton.dataset.investmentDetail);
});
$('details-invest-button').addEventListener('click', () => {
  const planId = selectedPlan?.id;
  $('details-dialog').close();
  if (planId) openPlan(planId);
});
$('show-login').addEventListener('click', () => showAuthMode('login'));
$('show-register').addEventListener('click', () => showAuthMode('register'));
document.querySelectorAll('[data-auth]').forEach((button) => {
  button.addEventListener('click', () => showAuthMode(button.dataset.auth));
});
$('auth-back').addEventListener('click', () => {
  $('auth-screen').hidden = true;
  $('landing').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('register-form').addEventListener('submit', registerAccount);
$('login-form').addEventListener('submit', login);
$('forgot-password-button').addEventListener('click', () => {
  $('reset-email').value = $('login-email').value.trim();
  $('reset-recovery-key').value = '';
  $('reset-request-message').textContent = '';
  $('reset-request-message').classList.remove('success');
  showPasswordRecovery('request');
});
$('password-reset-request-form').addEventListener('submit', requestPasswordReset);
$('password-reset-form').addEventListener('submit', confirmPasswordReset);
$('deposit-form').addEventListener('submit', addDeposit);
$('withdraw-form').addEventListener('submit', addWithdrawal);
$('plan-form').addEventListener('submit', startInvestment);
$('copy-invite-link').addEventListener('click', async () => {
  const link = $('invite-link').value;
  try {
    await navigator.clipboard.writeText(link);
    toast('Invitation link copied.');
  } catch {
    $('invite-link').select();
    document.execCommand('copy');
    toast('Invitation link copied.');
  }
});
$('spin-wheel').addEventListener('click', spinDailyWheel);
$('open-notifications').addEventListener('click', async () => {
  $('notifications-dialog').showModal();
  const latestActivityAt = current.transactions.reduce((latest, item) => Math.max(latest, item.date || 0), 0);
  const earningsNotice = readEarningsNoticeState();
  earningsNotice.ids = [];
  localStorage.setItem(earningsNoticeKey(), JSON.stringify(earningsNotice));
  current.preferences = { ...(current.preferences || {}), notificationsSeenAt: latestActivityAt };
  $('notification-dot').hidden = true;
  await saveAccounts(current);
});
$('history-filters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-history-filter]');
  if (!button) return;
  selectedHistoryFilter = button.dataset.historyFilter;
  renderFullHistory();
});
$('edit-wallet-button').addEventListener('click', () => $('wallet-dialog').showModal());
$('edit-withdrawal-pin-button').addEventListener('click', () => {
  setError('withdrawal-pin-error');
  $('withdrawal-pin-form').reset();
  $('withdrawal-pin-dialog').showModal();
});
$('admin-credentials-form').addEventListener('submit', updateAdminCredentials);
$('admin-generate-recovery-key').addEventListener('click', async () => {
  const emailField = $('admin-recovery-email');
  if (!emailField.reportValidity()) return;
  const email = emailField.value.trim().toLowerCase();
  const existing = accounts.find((account) => account.email.toLowerCase() === email);
  if (existing?.recoveryKeySet && !confirm('This account already has an admin-issued key. Replace it?')) return;
  try {
    const result = await apiRequest('/api/admin/recovery-key', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    const index = accounts.findIndex((account) => account.id === result.account.id);
    if (index >= 0) accounts[index] = result.account;
    render();
    showRecoveryKey(result.recoveryCode, result.account.email);
  } catch (error) {
    toast(error.message);
  }
});
$('email-support-button').addEventListener('click', () => {
  const emailField = $('reset-email');
  if (!emailField.reportValidity()) return;
  const email = emailField.value.trim().toLowerCase();
  const subject = 'Password recovery and recovery key request';
  const body = 'Hello Support,\n\nI need help recovering the account registered with ' + email +
    '. Please verify my ownership and provide an admin-issued recovery key so I can reset my password.\n\nThank you.';
  location.href = 'mailto:info.cup9@yahoo.com?subject=' + encodeURIComponent(subject) +
    '&body=' + encodeURIComponent(body);
});
$('copy-recovery-key').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('recovery-key-value').value);
    toast('Recovery key copied.');
  } catch {
    $('recovery-key-value').select();
    toast('Select and copy the recovery key.');
  }
});
$('copy-recovery-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('recovery-link-value').value);
    toast('Recovery link copied.');
  } catch {
    $('recovery-link-value').select();
    toast('Select and copy the recovery link.');
  }
});
$('recovery-key-saved').addEventListener('click', () => $('recovery-key-dialog').close());
$('recovery-key-dialog').addEventListener('cancel', (event) => event.preventDefault());
$('recovery-key-dialog').addEventListener('close', () => {
  $('recovery-key-value').value = '';
  $('recovery-link-value').value = '';
});
$('change-password-button').addEventListener('click', () => {
  setError('password-error');
  $('password-form').reset();
  $('password-dialog').showModal();
});
$('wallet-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const address = $('wallet-address').value.trim();
  if (!address) return;
  try {
    const result = await apiRequest('/api/withdrawal-wallet', {
      method: 'POST',
      body: JSON.stringify({ network: $('wallet-network').value, address }),
    });
    applyAccount(result.account);
    $('wallet-dialog').close();
    toast(result.requested ? 'Wallet change sent for admin approval.' : 'Withdrawal wallet linked.');
  } catch (error) {
    toast(error.message);
  }
});
$('withdrawal-pin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('withdrawal-pin-error');
  const pin = $('new-withdrawal-pin').value;
  if (!/^\d{6}$/.test(pin)) {
    setError('withdrawal-pin-error', 'Withdrawal password must contain exactly 6 digits.');
    return;
  }
  if (pin !== $('confirm-withdrawal-pin').value) {
    setError('withdrawal-pin-error', 'Withdrawal passwords do not match.');
    return;
  }
  try {
    const { account } = await apiRequest('/api/auth/withdrawal-password', {
      method: 'PUT',
      body: JSON.stringify({ loginPassword: $('pin-login-password').value, pin }),
    });
    applyAccount(account);
    $('withdrawal-pin-dialog').close();
    $('withdrawal-pin-form').reset();
    toast('Withdrawal password saved.');
  } catch (error) {
    setError('withdrawal-pin-error', error.message);
  }
});
$('password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('password-error');
  const newPassword = $('new-password').value;
  if (newPassword !== $('confirm-new-password').value) {
    setError('password-error', 'New passwords do not match.');
    return;
  }
  try {
    const { account } = await apiRequest('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({
        currentPassword: $('current-password').value,
        newPassword,
      }),
    });
    Object.assign(current, account);
    $('password-dialog').close();
    $('password-form').reset();
    toast('Password updated in this browser.');
  } catch (error) {
    setError('password-error', error.message);
  }
});
$('language-select').addEventListener('change', async (event) => {
  const previous = current.preferences?.language || 'en';
  current.preferences = { ...(current.preferences || {}), language: event.target.value };
  if (!await saveAccounts(current)) {
    current.preferences.language = previous;
    render();
    return;
  }
  language = event.target.value;
  localStorage.setItem(LANGUAGE_KEY, language);
  $('landing-language-select').value = language;
  render();
});
$('landing-language-select').value = language;
$('landing-language-select').addEventListener('change', (event) => {
  language = LANGUAGES.includes(event.target.value) ? event.target.value : 'en';
  localStorage.setItem(LANGUAGE_KEY, language);
  document.documentElement.lang = language;
  $('language-select').value = language;
  translatePage(language);
});
$('deposit-network').addEventListener('change', refreshDepositAddressDisplay);
$('copy-deposit-address').addEventListener('click', async () => {
  const address = depositAddresses[$('deposit-network').value];
  if (!address) return;
  try {
    await navigator.clipboard.writeText(address);
    toast('Deposit address copied.');
  } catch {
    toast('Could not copy deposit address.');
  }
});
$('save-deposit-addresses').addEventListener('click', async () => {
  const addresses = Object.fromEntries(['bep20', 'bitcoin', 'trc20'].map((network) => [
    network, $(`admin-address-${network}`).value.trim(),
  ]));
  try {
    const result = await apiRequest('/api/admin/deposit-addresses', {
      method: 'PUT',
      body: JSON.stringify({ addresses }),
    });
    depositAddresses = result.addresses;
    refreshDepositAddressDisplay();
    toast('Deposit addresses saved.');
  } catch (error) {
    toast(error.message);
  }
});
$('theme-select').addEventListener('change', async (event) => {
  const previous = current.preferences?.theme || 'dark';
  current.preferences = { ...(current.preferences || {}), theme: event.target.value };
  document.documentElement.dataset.theme = event.target.value;
  if (!await saveAccounts(current)) {
    current.preferences.theme = previous;
    render();
    return;
  }
  render();
});
$('refresh-account').addEventListener('click', () => {
  refreshAccount();
});
$('home-link').addEventListener('click', (event) => {
  event.preventDefault();
  setView('home');
});
$('open-admin').addEventListener('click', () => setView('admin'));
$('logout-button').addEventListener('click', signOut);
$('reset-account-data').addEventListener('click', () => {
  if (!current || current.role !== 'admin') return;
  if (!confirm('Delete all accounts and activity saved in this browser?')) return;
  apiRequest('/api/admin/accounts', { method: 'DELETE' }).then(() => signOut()).catch((error) => toast(error.message));
});
document.addEventListener('touchstart', (event) => {
  const target = event.target;
  if (!current || window.scrollY > 0 || event.touches.length !== 1 ||
      target.closest('input, textarea, select, button, a, dialog[open], [contenteditable="true"]')) {
    pullStartY = null;
    return;
  }
  pullStartY = event.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', (event) => {
  if (pullStartY === null) return;
  const pulledDistance = event.changedTouches[0].clientY - pullStartY;
  pullStartY = null;
  if (current && window.scrollY <= 0 && pulledDistance >= 80 &&
      !document.querySelector('dialog[open]')) {
    refreshAccount();
  }
}, { passive: true });
document.addEventListener('touchcancel', () => {
  pullStartY = null;
}, { passive: true });
document.querySelectorAll('.modal').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
}));

function initializeApp() {
  document.documentElement.lang = language;
  $('landing-language-select').value = language;
  translatePage(language);

  const searchParams = new URLSearchParams(window.location.search);
  $('register-referral').value = searchParams.get('ref') || '';
  pendingPasswordResetToken = searchParams.get('reset') || '';

  const recoveryFragment = location.hash.slice(1);
  if (recoveryFragment.startsWith('recover?')) {
    const recoveryParams = new URLSearchParams(recoveryFragment.slice('recover?'.length));
    const recoveryEmail = recoveryParams.get('email') || '';
    const recoveryCode = recoveryParams.get('key') || '';
    if (recoveryEmail && recoveryCode) {
      $('reset-email').value = recoveryEmail;
      $('reset-recovery-key').value = recoveryCode;
      showPasswordRecovery('request');
      const cleanUrl = new URL(location.href);
      cleanUrl.hash = '';
      history.replaceState(null, '', cleanUrl);
    }
  }
  if (pendingPasswordResetToken) showPasswordRecovery('confirm');

  resumeSession();
  setInterval(() => {
    if (!current || document.hidden) return;
    refreshAccount();
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && current) refreshAccount();
  });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
} else {
  initializeApp();
}
