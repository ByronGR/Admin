'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  db,
  collection,
  getDocs,
  query,
  where,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { fmtNumber } from '@/lib/utils';
import type { Placement } from '@/lib/types';
import { RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Minus, Sparkles } from 'lucide-react';

// ─── NCR formula ──────────────────────────────────────────────────────────────

function calcNCR(rate: number): number {
  return Math.max(2500, rate - 250);
}

function formatCOP(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

// ─── Currency API ─────────────────────────────────────────────────────────────

async function fetchCurrentRate(): Promise<{ rate: number; date: string } | null> {
  try {
    const r = await fetch(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
    );
    const d = await r.json();
    const rate = Number(d.usd?.cop);
    if (!rate) return null;
    return { rate, date: d.date as string };
  } catch {
    return null;
  }
}

async function fetch90DayHistory(): Promise<Array<{ date: string; rate: number }>> {
  const dates: string[] = [];
  for (let i = 90; i >= 0; i -= 9) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const results = await Promise.allSettled(
    dates.map((date) =>
      fetch(
        `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.min.json`,
      )
        .then((r) => r.json())
        .then((d) => ({ date: d.date as string, rate: Number(d.usd?.cop) })),
    ),
  );
  return results
    .filter(
      (r): r is PromiseFulfilledResult<{ date: string; rate: number }> =>
        r.status === 'fulfilled' && r.value.rate > 0,
    )
    .map((r) => r.value)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SalaryRatesPage() {
  const { showToast } = useToast();

  const [currentRate, setCurrentRate] = useState<{ rate: number; date: string } | null>(null);
  const [history, setHistory] = useState<Array<{ date: string; rate: number }>>([]);
  const [fxLoading, setFxLoading] = useState(true);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [placementsLoading, setPlacementsLoading] = useState(true);

  // Standard calculator
  const [copInput, setCopInput] = useState('');
  const [partnerUSD, setPartnerUSD] = useState('');
  const [calcResult, setCalcResult] = useState<{
    ncrCOP: number;
    ncrUSD: number;
    clientUSD: number;
    margin: number;
    marginPct: number;
    alert: boolean;
  } | null>(null);

  // Smart NCR suggestion
  const [ncrUsdMin, setNcrUsdMin] = useState('');
  const [ncrUsdMax, setNcrUsdMax] = useState('');

  const loadFX = useCallback(async () => {
    setFxLoading(true);
    const [rate, hist] = await Promise.all([
      fetchCurrentRate(),
      fetch90DayHistory(),
    ]);
    setCurrentRate(rate);
    setHistory(hist);
    setFxLoading(false);
  }, []);

  useEffect(() => {
    loadFX();
    getDocs(query(collection(db, 'placements'), where('salaryCurrency', '==', 'COP')))
      .then((snap) => {
        setPlacements(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Placement)));
        setPlacementsLoading(false);
      })
      .catch(() => setPlacementsLoading(false));
  }, [loadFX]);

  // Standard calculator
  useEffect(() => {
    const cop = Number(copInput.replace(/[,.]/g, ''));
    const usd = Number(partnerUSD.replace(/[,$]/g, ''));
    if (!cop || !usd || !currentRate?.rate) {
      setCalcResult(null);
      return;
    }
    const ncrCOP = calcNCR(currentRate.rate);
    const candidateCostUSD = cop / ncrCOP;
    const margin = usd - candidateCostUSD;
    const marginPct = (margin / usd) * 100;
    setCalcResult({
      ncrCOP,
      ncrUSD: ncrCOP,
      clientUSD: usd,
      margin,
      marginPct,
      alert: marginPct < 15,
    });
  }, [copInput, partnerUSD, currentRate]);

  // Smart NCR suggestion derived values
  const avg90 = history.length > 0
    ? history.reduce((s, h) => s + h.rate, 0) / history.length
    : 0;
  const trendPct = avg90 > 0 && currentRate
    ? ((currentRate.rate - avg90) / avg90) * 100
    : 0;
  const isVolatile = Math.abs(trendPct) > 3;
  // If volatile and rate is trending DOWN (bad for converting COP salaries), use conservative avg
  const conservativeRate = trendPct < -3 ? avg90 : currentRate?.rate ?? 0;
  const safeNCR = calcNCR(conservativeRate);
  const currentNCR = currentRate ? calcNCR(currentRate.rate) : 0;

  const ncrSuggestion = (() => {
    const minUSD = Number(ncrUsdMin.replace(/[,$]/g, ''));
    const maxUSD = Number(ncrUsdMax.replace(/[,$]/g, ''));
    if (!minUSD || !currentRate) return null;

    const effectiveMax = maxUSD || minUSD;
    const ncrUsed = isVolatile && trendPct < 0 ? safeNCR : currentNCR;

    // COP salary = USD salary * NCR rate (how much COP to offer for USD salary)
    const copMin = Math.round(minUSD * ncrUsed);
    const copMax = Math.round(effectiveMax * ncrUsed);

    // Suggested partner billing: add 15% margin on top of candidate cost
    const suggestedBillingMin = Math.round(minUSD * 1.15 * 100) / 100;
    const suggestedBillingMax = Math.round(effectiveMax * 1.15 * 100) / 100;

    return { copMin, copMax, ncrUsed, suggestedBillingMin, suggestedBillingMax, minUSD, maxUSD };
  })();

  // Chart
  const chartWidth = 600;
  const chartHeight = 80;
  const minRate = history.length > 0 ? Math.min(...history.map((h) => h.rate)) * 0.998 : 4000;
  const maxRate = history.length > 0 ? Math.max(...history.map((h) => h.rate)) * 1.002 : 5000;

  function rateToY(rate: number) {
    return chartHeight - ((rate - minRate) / (maxRate - minRate)) * chartHeight;
  }

  const points = history.map((h, i) => ({
    x: (i / Math.max(history.length - 1, 1)) * chartWidth,
    y: rateToY(h.rate),
    ...h,
  }));

  const pathD =
    points.length > 0
      ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      : '';

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">
              FX Calculator & Salary Rates
            </h1>
            <p className="mt-0.5 text-xs text-[var(--light)]">
              NCR conversion, COP salary benchmarks, and smart billing suggestions.
            </p>
          </div>
          <button
            onClick={loadFX}
            disabled={fxLoading}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${fxLoading ? 'animate-spin' : ''}`} />
            Refresh FX rate
          </button>
        </div>

        {/* FX Rate bar */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          {fxLoading ? (
            <div className="flex items-center gap-2 text-xs text-[var(--light)]">
              <Spinner size="sm" />
              Loading FX data...
            </div>
          ) : currentRate ? (
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">USD/COP spot rate</p>
                <p className="mt-0.5 text-2xl font-800 text-[var(--black)]">
                  {fmtNumber(Math.round(currentRate.rate))} <span className="text-sm font-500 text-[var(--light)]">COP</span>
                </p>
                <p className="text-[10px] text-[var(--light)]">As of {currentRate.date} · ExchangeRate CDN</p>
              </div>
              <div className="h-8 w-px bg-[var(--border)]" />
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">NCR rate (max(2500, rate−250))</p>
                <p className="mt-0.5 text-xl font-700 text-[var(--green)]">
                  {fmtNumber(currentNCR)} <span className="text-xs font-500 text-[var(--light)]">COP</span>
                </p>
                <p className="text-[10px] text-[var(--light)]">Nearwork client billing reference</p>
              </div>
              <div className="h-8 w-px bg-[var(--border)]" />
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">90-day avg</p>
                <p className="mt-0.5 text-base font-700 text-[var(--black)]">
                  {avg90 > 0 ? fmtNumber(Math.round(avg90)) : '—'} <span className="text-xs text-[var(--light)]">COP</span>
                </p>
              </div>
              <div className="h-8 w-px bg-[var(--border)]" />
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Trend vs 90d avg</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  {Math.abs(trendPct) < 1 ? (
                    <Minus className="h-4 w-4 text-[var(--light)]" />
                  ) : trendPct > 0 ? (
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-500" />
                  )}
                  <span className={`text-sm font-700 ${isVolatile ? (trendPct > 0 ? 'text-green-600' : 'text-red-500') : 'text-[var(--mid)]'}`}>
                    {trendPct > 0 ? '+' : ''}{trendPct.toFixed(1)}%
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-700 uppercase ${isVolatile ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                    {isVolatile ? 'Volatile' : 'Stable'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--light)]">Failed to load FX data.</p>
          )}
        </div>

        {/* Smart NCR Suggestion */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <div className="mb-1 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--green)]" />
            <h3 className="text-sm font-700 text-[var(--black)]">Smart NCR Suggestion</h3>
          </div>
          <p className="mb-5 text-xs text-[var(--light)]">
            Enter the USD salary for a role and get the recommended COP offer range with trend-safe NCR rate.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 mb-4">
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                USD salary — min (monthly)
              </label>
              <input
                value={ncrUsdMin}
                onChange={(e) => setNcrUsdMin(e.target.value)}
                placeholder="1,500"
                inputMode="numeric"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                USD salary — max (monthly) <span className="normal-case font-400">optional</span>
              </label>
              <input
                value={ncrUsdMax}
                onChange={(e) => setNcrUsdMax(e.target.value)}
                placeholder="2,000"
                inputMode="numeric"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              />
            </div>
          </div>

          {ncrSuggestion ? (
            <div className="space-y-3">
              {/* Trend warning */}
              {isVolatile && trendPct < 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="text-xs text-amber-700">
                    <span className="font-700">Rate is volatile</span> — the spot rate is {Math.abs(trendPct).toFixed(1)}% below the 90-day average.
                    We&apos;re using the <span className="font-700">conservative NCR ({fmtNumber(safeNCR)})</span> to protect your margins.
                  </div>
                </div>
              )}
              {isVolatile && trendPct > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3">
                  <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />
                  <div className="text-xs text-green-700">
                    Rate trending <span className="font-700">UP +{trendPct.toFixed(1)}%</span> — favorable for COP-denominated offers. Current NCR ({fmtNumber(currentNCR)}) is being used.
                  </div>
                </div>
              )}

              {/* Results grid */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 sm:grid-cols-4">
                <div>
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">NCR rate used</p>
                  <p className="mt-0.5 text-sm font-800 text-[var(--black)]">{fmtNumber(ncrSuggestion.ncrUsed)}</p>
                  <p className="text-[9px] text-[var(--light)]">{isVolatile && trendPct < 0 ? 'Conservative (90d avg)' : 'Current spot'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">COP offer</p>
                  <p className="mt-0.5 text-sm font-800 text-[var(--green)]">
                    {formatCOP(ncrSuggestion.copMin)}
                    {ncrSuggestion.maxUSD > 0 && ` – ${formatCOP(ncrSuggestion.copMax)}`}
                  </p>
                  <p className="text-[9px] text-[var(--light)]">Monthly COP equivalent</p>
                </div>
                <div>
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">USD cost to NW</p>
                  <p className="mt-0.5 text-sm font-800 text-[var(--black)]">
                    ${ncrSuggestion.minUSD.toLocaleString()}
                    {ncrSuggestion.maxUSD > 0 && ` – $${ncrSuggestion.maxUSD.toLocaleString()}`}
                  </p>
                  <p className="text-[9px] text-[var(--light)]">Pass-through to candidate</p>
                </div>
                <div>
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Suggested billing</p>
                  <p className="mt-0.5 text-sm font-800 text-[var(--green)]">
                    ${ncrSuggestion.suggestedBillingMin.toLocaleString()}
                    {ncrSuggestion.maxUSD > 0 && ` – $${ncrSuggestion.suggestedBillingMax.toLocaleString()}`}
                  </p>
                  <p className="text-[9px] text-[var(--light)]">+15% margin to partner</p>
                </div>
              </div>

              <p className="text-[10px] text-[var(--light)]">
                Formula: COP offer = USD salary × NCR rate. Billing = USD salary × 1.15 (15% target margin). Adjust margin manually as needed.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-6 text-center text-xs text-[var(--light)]">
              Enter a USD salary above to see the suggestion.
            </div>
          )}
        </div>

        {/* Standard Calculator + 90-day chart */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* FX Calculator */}
          <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
            <h3 className="mb-1 text-sm font-700 text-[var(--black)]">FX Calculator</h3>
            <p className="mb-5 text-xs text-[var(--light)]">
              Enter a candidate&apos;s COP salary to review client billing and margin.
            </p>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Candidate monthly salary (COP)
                </label>
                <input
                  value={copInput}
                  onChange={(e) => setCopInput(e.target.value)}
                  placeholder="8,000,000"
                  inputMode="numeric"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Partner monthly charge (USD)
                </label>
                <input
                  value={partnerUSD}
                  onChange={(e) => setPartnerUSD(e.target.value)}
                  placeholder="2,600"
                  inputMode="numeric"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
                />
              </div>
            </div>

            {calcResult && (
              <div className={`mt-5 rounded-xl border p-4 ${calcResult.alert ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
                {calcResult.alert && (
                  <div className="mb-3 flex items-center gap-2 text-xs font-600 text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                    Margin alert — below 15% threshold
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">NCR rate used</p>
                    <p className="mt-0.5 font-700 text-[var(--black)]">{fmtNumber(calcResult.ncrCOP)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Candidate cost (USD)</p>
                    <p className="mt-0.5 font-700 text-[var(--black)]">
                      ${(Number(copInput.replace(/[,.]/g, '')) / calcResult.ncrCOP).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Gross margin</p>
                    <p className={`mt-0.5 font-800 ${calcResult.alert ? 'text-amber-700' : 'text-green-700'}`}>
                      ${calcResult.margin.toFixed(2)} ({calcResult.marginPct.toFixed(1)}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Client billing</p>
                    <p className="mt-0.5 font-700 text-[var(--black)]">${calcResult.clientUSD}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 90-day history chart */}
          <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
            <h3 className="mb-1 text-sm font-700 text-[var(--black)]">90-day USD/COP history</h3>
            <p className="mb-5 text-xs text-[var(--light)]">
              Spot rate vs Nearwork&apos;s internal NCR billing reference.
            </p>

            {fxLoading ? (
              <div className="flex h-24 items-center justify-center">
                <Spinner size="sm" />
              </div>
            ) : points.length === 0 ? (
              <p className="text-xs text-[var(--light)]">No history data available.</p>
            ) : (
              <div className="space-y-2">
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  className="w-full"
                  style={{ height: 100 }}
                >
                  {/* 90-day avg reference line */}
                  {avg90 > 0 && (
                    <line
                      x1="0"
                      y1={rateToY(avg90).toFixed(1)}
                      x2={chartWidth}
                      y2={rateToY(avg90).toFixed(1)}
                      stroke="var(--light)"
                      strokeWidth="1"
                      strokeDasharray="4,4"
                      opacity="0.5"
                    />
                  )}
                  {/* NCR reference line */}
                  {currentRate && (
                    <line
                      x1="0"
                      y1={rateToY(calcNCR(currentRate.rate)).toFixed(1)}
                      x2={chartWidth}
                      y2={rateToY(calcNCR(currentRate.rate)).toFixed(1)}
                      stroke="var(--green)"
                      strokeWidth="1"
                      strokeDasharray="4,4"
                      opacity="0.6"
                    />
                  )}
                  {/* Spot rate line */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="var(--black)"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  {/* Current point */}
                  {points.length > 0 && (
                    <circle
                      cx={points[points.length - 1].x.toFixed(1)}
                      cy={points[points.length - 1].y.toFixed(1)}
                      r="4"
                      fill="var(--green)"
                    />
                  )}
                </svg>
                <div className="flex justify-between text-[10px] text-[var(--light)]">
                  <span>{points[0]?.date}</span>
                  <div className="flex items-center gap-3">
                    <span>— NCR</span>
                    <span style={{ color: 'var(--light)' }}>- - 90d avg</span>
                  </div>
                  <span>{points[points.length - 1]?.date}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Active COP placements */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <h3 className="mb-1 text-sm font-700 text-[var(--black)]">Active COP placements</h3>
          <p className="mb-4 text-xs text-[var(--light)]">
            COP-denominated placements monitored for FX margin and renegotiation alerts.
          </p>

          {placementsLoading ? (
            <div className="flex h-20 items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : placements.length === 0 ? (
            <p className="text-xs text-[var(--light)]">No COP placements tracked yet.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--border)]">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
                <div>Candidate</div>
                <div>Organization</div>
                <div>Salary (COP)</div>
                <div>NCR cost (USD)</div>
                <div>Alert</div>
              </div>
              {placements.map((p) => {
                const rate = currentRate?.rate ?? 4200;
                const ncr = calcNCR(rate);
                const candidateCost = (p.salaryAmount ?? 0) / ncr;
                const alert = p.ncrRate && p.ncrRate > 0
                  ? (p.ncrRate / rate - 1) * 100 > 5
                  : false;

                return (
                  <div key={p.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-0 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--bg)]">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-600 text-[var(--black)]">{p.candidateName ?? '—'}</p>
                    </div>
                    <div className="text-xs text-[var(--mid)]">{p.orgName ?? '—'}</div>
                    <div className="text-xs font-600 text-[var(--black)]">
                      {formatCOP(p.salaryAmount ?? 0)}
                    </div>
                    <div className="text-xs font-600 text-[var(--black)]">
                      ${candidateCost.toFixed(2)}
                    </div>
                    <div>
                      {alert ? (
                        <span className="flex items-center gap-1 text-[10px] font-600 text-amber-600">
                          <AlertTriangle className="h-3 w-3" />
                          Rate drift
                        </span>
                      ) : (
                        <span className="text-[10px] font-600 text-green-600">OK</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
