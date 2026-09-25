"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type LogicalRange,
} from "lightweight-charts";
import { api } from "@/lib/api";
import { IS_STATIC, staticPrices } from "@/lib/static";
import type { PriceInterval, PriceRange, Prices } from "@/lib/types";
import { num, price as fmtPrice, ptsSigned, signClass } from "@/lib/format";

type ChartType = "candles" | "line";
type IndicatorKey = "sma20" | "sma50" | "sma200" | "ema21" | "bb" | "volume" | "rsi" | "macd";
type Indicators = Record<IndicatorKey, boolean>;

interface Prefs {
  range: PriceRange;
  chartType: ChartType;
  indicators: Indicators;
}

/** `key` = "SYMBOL|range" the response belongs to, so a stale response never shows for the wrong request. */
type Status =
  | { kind: "idle"; key: null }
  | { kind: "ready"; key: string; data: Prices }
  | { kind: "missing"; key: string; message: string }
  | { kind: "error"; key: string; message: string };

const RANGES: { key: PriceRange; label: string; interval: PriceInterval }[] = [
  { key: "1m", label: "1M", interval: "1d" },
  { key: "3m", label: "3M", interval: "1d" },
  { key: "6m", label: "6M", interval: "1d" },
  { key: "1y", label: "1Y", interval: "1d" },
  { key: "2y", label: "2Y", interval: "1w" },
  { key: "5y", label: "5Y", interval: "1w" },
];

const INDICATOR_LABELS: { key: IndicatorKey; label: string }[] = [
  { key: "sma20", label: "SMA 20" },
  { key: "sma50", label: "SMA 50" },
  { key: "sma200", label: "SMA 200" },
  { key: "ema21", label: "EMA 21" },
  { key: "bb", label: "Bollinger" },
  { key: "volume", label: "Volume" },
  { key: "rsi", label: "RSI" },
  { key: "macd", label: "MACD" },
];

const DEFAULT_PREFS: Prefs = {
  range: "1y",
  chartType: "candles",
  indicators: { sma20: false, sma50: true, sma200: true, ema21: false, bb: false, volume: true, rsi: false, macd: false },
};

const STORAGE_KEY = "iie.pricechart.v1";
const MAIN_HEIGHT = 340;
const SUB_HEIGHT = 110;
/** Same right-axis width on every pane so the sub-panes line up with the price pane. */
const AXIS_MIN_WIDTH = 64;

function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    const range = RANGES.some((r) => r.key === p.range) ? (p.range as PriceRange) : DEFAULT_PREFS.range;
    const chartType = p.chartType === "line" || p.chartType === "candles" ? p.chartType : DEFAULT_PREFS.chartType;
    return { range, chartType, indicators: { ...DEFAULT_PREFS.indicators, ...(p.indicators ?? {}) } };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota: preferences just don't persist */
  }
}

/**
 * Preferences live in a tiny module-level store backed by localStorage and read
 * through useSyncExternalStore: the server snapshot is the defaults, so SSR and
 * hydration agree, and the persisted choice takes over right after mount.
 */
const prefListeners = new Set<() => void>();
let prefCache: Prefs | null = null;
function getPrefs(): Prefs {
  if (!prefCache) prefCache = loadPrefs();
  return prefCache;
}
function getServerPrefs(): Prefs {
  return DEFAULT_PREFS;
}
function subscribePrefs(cb: () => void) {
  prefListeners.add(cb);
  return () => {
    prefListeners.delete(cb);
  };
}
function updatePrefs(fn: (p: Prefs) => Prefs) {
  prefCache = fn(getPrefs());
  savePrefs(prefCache);
  prefListeners.forEach((l) => l());
}

/** Resolved palette read from the CSS variables in globals.css (canvas needs concrete colours). */
interface Palette {
  bg: string;
  text: string;
  muted: string;
  subtle: string;
  border: string;
  borderStrong: string;
  accent: string;
  pos: string;
  neg: string;
  sma20: string;
  sma50: string;
  sma200: string;
  ema21: string;
  bb: string;
  macd: string;
  signal: string;
  font: string;
}

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--surface", "#ffffff"),
    text: v("--text", "#1a1917"),
    muted: v("--text-muted", "#6f6c66"),
    subtle: v("--text-subtle", "#a3a09a"),
    border: v("--border", "#e4e3df"),
    borderStrong: v("--border-strong", "#cfcdc7"),
    accent: v("--accent", "#2563eb"),
    pos: v("--pos", "#15803d"),
    neg: v("--neg", "#b91c1c"),
    sma20: v("--accent", "#2563eb"),
    sma50: v("--regime-reflation", "#d19a2b"),
    sma200: v("--regime-contraction", "#5b7fb5"),
    ema21: v("--regime-stagflation", "#c65a3c"),
    bb: v("--text-subtle", "#a3a09a"),
    macd: v("--accent", "#2563eb"),
    signal: v("--regime-reflation", "#d19a2b"),
    font: getComputedStyle(document.body).fontFamily || "system-ui, sans-serif",
  };
}

/** "#rrggbb" -> "rgba(r,g,b,a)"; anything else is returned unchanged. */
function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Value series aligned to bars; nulls become whitespace so the time axis stays identical across panes. */
function lineData(bars: Prices["bars"], values: (number | null)[]) {
  return bars.map((b, i) => {
    const v = values?.[i];
    return v === null || v === undefined || !Number.isFinite(v) ? { time: b.t } : { time: b.t, value: v };
  });
}

function baseChartOptions(pal: Palette, height: number, sub: boolean) {
  return {
    height,
    layout: {
      background: { type: ColorType.Solid, color: pal.bg },
      textColor: pal.muted,
      fontSize: 11,
      fontFamily: pal.font,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: alpha(pal.border, 0.6), style: LineStyle.Solid, visible: true },
      horzLines: { color: alpha(pal.border, 0.6), style: LineStyle.Solid, visible: true },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: pal.subtle, width: 1 as const, style: LineStyle.Dashed, labelBackgroundColor: pal.borderStrong },
      horzLine: { color: pal.subtle, width: 1 as const, style: LineStyle.Dashed, labelBackgroundColor: pal.borderStrong },
    },
    rightPriceScale: { borderColor: pal.border, minimumWidth: AXIS_MIN_WIDTH, scaleMargins: { top: 0.08, bottom: sub ? 0.08 : 0.22 } },
    timeScale: { borderColor: pal.border, visible: !sub, timeVisible: false, rightOffset: 3, fixLeftEdge: true, fixRightEdge: true },
    handleScroll: !sub,
    handleScale: !sub,
  };
}

/**
 * OHLCV chart for one symbol with timeframe, candles/line and indicator toggles.
 * The price pane carries the overlays (SMA/EMA/Bollinger) and a volume histogram;
 * RSI and MACD render as separate small charts synced to the main time scale.
 * Colours come from the CSS variables in globals.css and the charts are rebuilt
 * when the colour scheme flips. Preferences persist in localStorage.
 */
export function PriceChart({ symbol }: { symbol: string }) {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, getServerPrefs);
  const setPrefs = updatePrefs;
  const [status, setStatus] = useState<Status>({ kind: "idle", key: null });
  const [themeTick, setThemeTick] = useState(0);

  const mainRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  /** Last visible range, so an indicator toggle (which rebuilds the charts) keeps the user's zoom. */
  const rangeRef = useRef<LogicalRange | null>(null);
  const lastDataRef = useRef<Prices | null>(null);

  // Rebuild on colour-scheme flips so the canvas picks up the new CSS variables.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setThemeTick((t) => t + 1);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Data: refetch when the symbol or timeframe changes. Loading is derived (status.key lags reqKey) rather than set in the effect.
  // Static export: the 1y_1d / 5y_1w files under /data/api/prices are fetched directly and sliced to the range client-side.
  const interval = RANGES.find((r) => r.key === prefs.range)?.interval ?? "1d";
  const reqKey = `${symbol.toUpperCase()}|${prefs.range}`;
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    const key = reqKey;
    const load = IS_STATIC ? staticPrices(symbol, prefs.range, ctrl.signal) : api.prices(symbol, prefs.range, interval, ctrl.signal);
    load.then((res) => {
      if (cancelled) return;
      if (res.ok) setStatus({ kind: "ready", key, data: res.data });
      else if (res.status === 404) setStatus({ kind: "missing", key, message: res.message });
      else setStatus({ kind: "error", key, message: res.message });
    });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [symbol, prefs.range, interval, reqKey]);

  const loading = status.key !== reqKey;
  // Keep the previous bars on screen while the next timeframe loads.
  const data = status.kind === "ready" ? status.data : null;
  const { chartType, indicators: ind } = prefs;

  // Charts: built from scratch whenever data, toggles or the theme change; torn down on cleanup.
  useEffect(() => {
    const mainEl = mainRef.current;
    if (!mainEl || !data || !data.bars.length) return;
    const pal = readPalette();
    const bars = data.bars;
    const I = data.indicators;
    const charts: IChartApi[] = [];

    const main = createChart(mainEl, baseChartOptions(pal, MAIN_HEIGHT, false));
    charts.push(main);

    if (chartType === "candles") {
      const s = main.addSeries(CandlestickSeries, {
        upColor: pal.pos,
        downColor: pal.neg,
        borderVisible: false,
        wickUpColor: pal.pos,
        wickDownColor: pal.neg,
        priceLineColor: pal.subtle,
      });
      s.setData(bars.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })));
    } else {
      const s = main.addSeries(LineSeries, { color: pal.text, lineWidth: 2, priceLineColor: pal.subtle, crosshairMarkerRadius: 3 });
      s.setData(bars.map((b) => ({ time: b.t, value: b.c })));
    }

    const overlay = (values: (number | null)[], color: string, style: LineStyle = LineStyle.Solid, title = "") =>
      main
        .addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: style,
          title,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        .setData(lineData(bars, values));

    if (ind.bb) {
      overlay(I.bb_upper, alpha(pal.bb, 0.9), LineStyle.Dashed);
      overlay(I.bb_lower, alpha(pal.bb, 0.9), LineStyle.Dashed);
    }
    if (ind.sma200) overlay(I.sma200, pal.sma200);
    if (ind.sma50) overlay(I.sma50, pal.sma50);
    if (ind.sma20) overlay(I.sma20, pal.sma20);
    if (ind.ema21) overlay(I.ema21, pal.ema21);

    if (ind.volume) {
      const vol = main.addSeries(HistogramSeries, {
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      });
      vol.setData(
        bars.map((b, i) => ({
          time: b.t,
          value: b.v,
          color: alpha(b.c >= (bars[i - 1]?.c ?? b.o) ? pal.pos : pal.neg, 0.35),
        })),
      );
      main.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    }

    // Sub-panes: no own interaction; they follow the main time scale.
    if (ind.rsi && rsiRef.current) {
      const c = createChart(rsiRef.current, baseChartOptions(pal, SUB_HEIGHT, true));
      charts.push(c);
      const s = c.addSeries(LineSeries, {
        color: pal.accent,
        lineWidth: 1,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: { type: "price", precision: 0, minMove: 1 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      });
      s.setData(lineData(bars, I.rsi14));
      for (const level of [30, 70]) {
        s.createPriceLine({ price: level, color: pal.subtle, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false });
      }
    }
    if (ind.macd && macdRef.current) {
      const c = createChart(macdRef.current, baseChartOptions(pal, SUB_HEIGHT, true));
      charts.push(c);
      const hist = c.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, base: 0 });
      hist.setData(
        bars.map((b, i) => {
          const v = I.macd_hist?.[i];
          return v === null || v === undefined ? { time: b.t } : { time: b.t, value: v, color: alpha(v >= 0 ? pal.pos : pal.neg, 0.5) };
        }),
      );
      c.addSeries(LineSeries, { color: pal.macd, lineWidth: 1, priceLineVisible: false, crosshairMarkerVisible: false }).setData(lineData(bars, I.macd));
      c.addSeries(LineSeries, { color: pal.signal, lineWidth: 1, priceLineVisible: false, crosshairMarkerVisible: false, lastValueVisible: false }).setData(
        lineData(bars, I.macd_signal),
      );
    }

    // Keep the sub-panes on the main pane's visible range, and remember it across rebuilds.
    const subs = charts.slice(1);
    const onRange = (r: LogicalRange | null) => {
      rangeRef.current = r;
      if (r) for (const c of subs) c.timeScale().setVisibleLogicalRange(r);
    };
    main.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    if (lastDataRef.current === data && rangeRef.current) {
      main.timeScale().setVisibleLogicalRange(rangeRef.current);
    } else {
      main.timeScale().fitContent();
    }
    lastDataRef.current = data;

    // One observer for the whole block: every pane takes the container width.
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? mainEl.clientWidth);
      if (w > 0) for (const c of charts) c.applyOptions({ width: w });
    });
    ro.observe(mainEl);
    for (const c of charts) c.applyOptions({ width: mainEl.clientWidth });

    return () => {
      ro.disconnect();
      main.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      for (const c of charts) c.remove();
    };
  }, [data, chartType, ind, themeTick]);

  const toggle = (k: IndicatorKey) => setPrefs((p) => ({ ...p, indicators: { ...p.indicators, [k]: !p.indicators[k] } }));
  const L = data?.latest;

  const btn = (active: boolean) =>
    `rounded px-2 py-0.5 text-[11.5px] transition-colors ${active ? "bg-surface-3 font-medium text-ink" : "text-muted hover:text-ink"}`;
  const swatch = (color: string, dashed = false) => (
    <span
      className="inline-block h-0 w-3 align-middle"
      style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }}
      aria-hidden
    />
  );

  return (
    <section className="rounded-md border border-line bg-surface">
      {/* Latest strip */}
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[20px] font-semibold leading-none">{L ? fmtPrice(L.close) : "—"}</span>
          {L && <span className={`text-[13px] font-medium ${signClass(L.change_1d_pct)}`}>{ptsSigned(L.change_1d_pct, 2)}</span>}
        </div>
        {L && (
          <>
            <Strip label={`${prefs.range.toUpperCase()} change`} value={ptsSigned(L.change_range_pct)} cls={signClass(L.change_range_pct)} />
            <Strip label="SMA 50" value={num(L.sma50, 2)} />
            <Strip label="SMA 200" value={num(L.sma200, 2)} />
            <Strip label="RSI 14" value={num(L.rsi14, 0)} cls={L.rsi14 !== null && L.rsi14 >= 70 ? "text-neg" : L.rsi14 !== null && L.rsi14 <= 30 ? "text-pos" : ""} />
            <Strip label="From 52w high" value={ptsSigned(L.pct_from_52w_high)} cls={signClass(L.pct_from_52w_high)} />
            {L.signals?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {L.signals.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        <span className="ml-auto text-[11px] text-subtle">
          {loading ? "Loading…" : data ? `${data.n} bars · ${data.interval}` : ""}
        </span>
      </header>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line px-3 py-1.5">
        <div className="flex gap-0.5" role="group" aria-label="Timeframe">
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setPrefs((p) => ({ ...p, range: r.key }))} className={btn(prefs.range === r.key)} aria-pressed={prefs.range === r.key}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5" role="group" aria-label="Chart type">
          {(["candles", "line"] as ChartType[]).map((t) => (
            <button key={t} type="button" onClick={() => setPrefs((p) => ({ ...p, chartType: t }))} className={btn(chartType === t)} aria-pressed={chartType === t}>
              {t === "candles" ? "Candles" : "Line"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-0.5" role="group" aria-label="Indicators">
          {INDICATOR_LABELS.map((x) => (
            <button key={x.key} type="button" onClick={() => toggle(x.key)} className={btn(ind[x.key])} aria-pressed={ind[x.key]}>
              {x.label}
            </button>
          ))}
        </div>
        {data && (
          <div className="ml-auto flex flex-wrap gap-x-3 text-[10.5px] text-subtle">
            {ind.sma20 && <span>{swatch("var(--accent)")} SMA 20</span>}
            {ind.sma50 && <span>{swatch("var(--regime-reflation)")} SMA 50</span>}
            {ind.sma200 && <span>{swatch("var(--regime-contraction)")} SMA 200</span>}
            {ind.ema21 && <span>{swatch("var(--regime-stagflation)")} EMA 21</span>}
            {ind.bb && <span>{swatch("var(--text-subtle)", true)} Bollinger</span>}
          </div>
        )}
      </div>

      {/* Panes */}
      <div className="relative px-1 py-1">
        {loading && !data && (
          <div className="grid place-items-center text-[12.5px] text-muted" style={{ height: MAIN_HEIGHT }}>
            Loading prices…
          </div>
        )}
        {!loading && status.kind === "missing" && (
          <div className="grid place-items-center px-6 text-center text-[12.5px] text-muted" style={{ height: 120 }}>
            <div>
              No stored prices for <span className="mono">{symbol.toUpperCase()}</span>.
              <div className="mt-1 text-[11.5px] text-subtle">{status.message}</div>
            </div>
          </div>
        )}
        {!loading && status.kind === "error" && (
          <div className="grid place-items-center px-6 text-center text-[12.5px] text-muted" style={{ height: 120 }}>
            <div>
              Price chart unavailable.
              <div className="mono mt-1 text-[11.5px] text-neg">{status.message}</div>
            </div>
          </div>
        )}
        {data && !data.bars.length && (
          <div className="grid place-items-center text-[12.5px] text-muted" style={{ height: 120 }}>
            No bars in this range.
          </div>
        )}
        {data && data.bars.length > 0 && (
          <>
            <div ref={mainRef} style={{ height: MAIN_HEIGHT }} />
            {ind.rsi && (
              <div className="relative border-t border-line">
                <span className="pointer-events-none absolute left-2 top-1 z-10 text-[10.5px] text-subtle">RSI 14 · 30 / 70</span>
                <div ref={rsiRef} style={{ height: SUB_HEIGHT }} />
              </div>
            )}
            {ind.macd && (
              <div className="relative border-t border-line">
                <span className="pointer-events-none absolute left-2 top-1 z-10 text-[10.5px] text-subtle">MACD 12 / 26 / 9</span>
                <div ref={macdRef} style={{ height: SUB_HEIGHT }} />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Strip({ label, value, cls = "" }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10.5px] uppercase tracking-wide text-subtle">{label}</span>
      <span className={`text-[12.5px] font-medium ${cls}`}>{value}</span>
    </div>
  );
}
