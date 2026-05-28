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
import { RefreshCw, AlertTriangle } from 'lucide-react';

// ─── NCR formula ──────────────────────────────────────────────────────────────

function calcNCR(weightedAvgRate: number): number {
  return Math.max(2500, weightedAvgRate - 250);
}

function formatCOP(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

// ─── Frankfurter API ──────────────────────────────────────────────────────────

interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

interface FxHistory {
  start_date: string;
  end_date: string;
  base: string;
  rates: Record<string, Record<string, number>>;
}

async function fetchCurrentRate(): Promise<{ rate: number; date: string } | null> {
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=COP');
    const d: FrankfurterResponse = await r.json();
    return { rate: d.rates?.COP ?? 0, date: d.date };
  } catch {
    return null;
  }
}

async function fetch90DayHistory(): Promise<Array<{ date: string; rate: number }>> {
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 90);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const r = await fetch(`https://api.frankfurter.app/${fmt(start)}..${fmt(end)}?from=USD&to=COP`);
    const d: FxHistory = await r.json();
    return Object.entries(d.rates ?? {})
      .map(([date, rates]) => ({ date, rate: rates['COP'] ?? 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SalaryRatesPage() {
  const { showToast } = useToast();

  const [currentRate, setCurrentRate] = useState<{ rate: number; date: string } | null>(null);
  const [history, setHistory] = useState<Array<{ date: string; rate: number }>>([]);
  const [fxLoading, setFxLoading] = useState(true);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [placementsLoading, setPlacementsLoading] = useState(true);

  // Calculator
  const [copInput, setCopInput] = useState('');
  const [partnerUSD, setPartnerUSD] = useState('');

  // Calculator output
  const [calcResult, setCalcResult] = useState<{
    ncrCOP: number;
    ncrUSD: number;
    clientUSD: number;
    margin: number;
    marginPct: number;
    alert: boolean;
  } | null>(null);

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

  // Calculate on input change
  useEffect(() => {
    const cop = Number(copInput.replace(/[,.]/g, ''));
    const usd = Number(partnerUSD.replace(/[,$]/g, ''));
    if (!cop || !usd || !currentRate?.rate) {
      setCalcResult(null);
      return;
    }
    // NCR is what Nearwork charges partner (USD)
    const ncrCOP = calcNCR(currentRate.rate);
    const ncrUSD = ncrCOP / currentRate.rate; // not how it works — NCR is the rate used to bill
    // Candidate cost in USD = COP salary / NCR rate
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

  // Chart: simple SVG spark line for 90-day history
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
              NCR conversion, COP salary benchmarks, and COP placement margin alerts.
            </p>
          </div>
          <button
            onClick={loadFX}
            disabled={fxLoading}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${fxLoading ? 'animate-spin' : ''}`} />
            Refresh Frankfurter
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
                <p className="text-[10px] text-[var(--light)]">As of {currentRate.date} · Frankfurter</p>
              </div>
              <div className="h-8 w-px bg-[var(--border)]" />
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">NCR rate (max(2500, rate-250))</p>
                <p className="mt-0.5 text-xl font-700 text-[var(--green)]">
                  {fmtNumber(calcNCR(currentRate.rate))} <span className="text-xs font-500 text-[var(--light)]">COP</span>
                </p>
                <p className="text-[10px] text-[var(--light)]">Nearwork client billing reference</p>
              </div>
              <div className="h-8 w-px bg-[var(--border)]" />
              <div>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">90-day avg</p>
                <p className="mt-0.5 text-base font-700 text-[var(--black)]">
                  {history.length > 0 ? fmtNumber(Math.round(history.reduce((s, h) => s + h.rate, 0) / history.length)) : '—'} <span className="text-xs text-[var(--light)]">COP</span>
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--light)]">Failed to load FX data.</p>
          )}
        </div>

        {/* Calculator + 12-month projection */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* FX Calculator */}
          <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
            <h3 className="mb-1 text-sm font-700 text-[var(--black)]">FX Calculator</h3>
            <p className="mb-5 text-xs text-[var(--light)]">
              Enter a candidate&apos;s monthly COP salary to review client billing and margin health.
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
              Frankfurter spot line against Nearwork&apos;s internal NCR billing reference.
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
                  <span className="text-[var(--green)]">— NCR</span>
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
            Only COP-denominated placements are monitored for FX margin and renegotiation alerts.
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
                        <span className="text-[10px] text-green-600 font-600">OK</span>
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
