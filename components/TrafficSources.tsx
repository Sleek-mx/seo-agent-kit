"use client";

import { useEffect, useState } from "react";
import { PlatformDot } from "./PlatformDot";
import { formatNumber } from "../lib/format";
import type { SourceFamily, SourcePeriod, SourcePeriodKey } from "../lib/posthog-sources";

const PERIOD_KEY = "mos:traffic-sources:period";

// Where web-app visitors come from: PostHog
// session entry source (referring domain, or UTM source when set), grouped
// into families, with signups attributed to the same session source.

function rate(s: number, v: number): string {
  if (!v || !s) return "—";
  const p = (s / v) * 100;
  return `${p >= 10 ? p.toFixed(0) : p.toFixed(1)}%`;
}

function Icon({ src }: { src: SourceFamily }) {
  if (src.platform) return <PlatformDot platform={src.platform} size={20} />;
  if (src.domain) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(src.domain)}&sz=64`}
        alt=""
        width={20}
        height={20}
        className="size-5 rounded-full bg-white object-contain p-[2px] ring-1 ring-black/[.12]"
      />
    );
  }
  return (
    <span className="inline-flex size-5 items-center justify-center rounded-full bg-neutral-200 text-[9px] font-bold text-neutral-700 dark:bg-[var(--surface-3)] dark:text-neutral-200">
      ↗
    </span>
  );
}

/** Period tabs: Today / Yesterday / 7 days / 30 days. All
 *  four arrive from the server; switching is instant and remembered. */
export function TrafficSources({ periods, limit = 12 }: { periods: SourcePeriod[]; limit?: number }) {
  const [period, setPeriod] = useState<SourcePeriodKey>("30d");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PERIOD_KEY) as SourcePeriodKey | null;
      if (saved && periods.some((p) => p.key === saved)) setPeriod(saved);
    } catch {
      // storage blocked: default stays 30 days
    }
  }, [periods]);
  const pick = (k: SourcePeriodKey) => {
    setPeriod(k);
    try {
      window.localStorage.setItem(PERIOD_KEY, k);
    } catch {
      // ignore
    }
  };
  if (periods.length === 0) return null;
  const active = periods.find((p) => p.key === period) ?? periods[periods.length - 1];
  const sources = active.sources;
  if (sources.length === 0) {
    return (
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="card-title">Traffic sources</h2>
          <div className="flex rounded-full border border-black/[.08] p-0.5 text-[11px] dark:border-white/[.12]">
            {periods.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => pick(p.key)}
                className={`rounded-full px-2.5 py-0.5 ${
                  p.key === active.key
                    ? "bg-neutral-900 font-semibold text-white dark:bg-white dark:text-neutral-900"
                    : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-4 text-xs text-neutral-400">No visitors {active.label.toLowerCase()} yet.</p>
      </div>
    );
  }
  const top = sources.slice(0, limit);
  const rest = sources.slice(limit);
  const rows = rest.length
    ? [
        ...top,
        {
          key: "other",
          label: `Other (${rest.length})`,
          platform: null,
          domain: null,
          visitors: rest.reduce((s, r) => s + r.visitors, 0),
          signups: rest.reduce((s, r) => s + r.signups, 0),
        } satisfies SourceFamily,
      ]
    : top;
  const max = Math.max(...rows.map((r) => r.visitors), 1);
  const totalV = sources.reduce((s, r) => s + r.visitors, 0);
  const totalS = sources.reduce((s, r) => s + r.signups, 0);
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="card-title">Traffic sources</h2>
        <div className="flex rounded-full border border-black/[.08] p-0.5 text-[11px] dark:border-white/[.12]">
          {periods.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => pick(p.key)}
              className={`rounded-full px-2.5 py-0.5 transition ${
                p.key === active.key
                  ? "bg-neutral-900 font-semibold text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-neutral-400">where sessions started · {active.label.toLowerCase()}</p>
      <div className="mt-2 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 text-[10px] uppercase tracking-wide text-neutral-400">
        <span>source</span>
        <span className="text-right">visitors</span>
        <span className="text-right">signups</span>
        <span className="w-10 text-right">rate</span>
      </div>
      <ul className="mt-1.5 space-y-2">
        {rows.map((r) => (
          <li key={r.key} title={`${r.label}: ${formatNumber(r.visitors)} visitors, ${r.signups} signups`}>
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <Icon src={r} />
                <span className="truncate text-neutral-800 dark:text-neutral-100">{r.label}</span>
              </span>
              <span className="num text-right font-semibold tabular-nums">{formatNumber(r.visitors)}</span>
              <span
                className={`num text-right tabular-nums ${
                  r.signups > 0 ? "font-semibold text-[#a78bfa]" : "text-neutral-400"
                }`}
              >
                {r.signups}
              </span>
              <span className="w-10 text-right tabular-nums text-neutral-500">{rate(r.signups, r.visitors)}</span>
            </div>
            <div className="mt-1 ml-7 h-1.5 rounded-full bg-black/[.05] dark:bg-white/[.08]">
              <div
                className="h-1.5 rounded-full bg-[#475569]"
                style={{ width: `${Math.max(2, (r.visitors / max) * 100)}%` }}
              >
                {r.signups > 0 ? (
                  <div
                    className="h-1.5 rounded-full bg-[#a78bfa]"
                    style={{ width: `${Math.max(6, Math.min(100, (r.signups / r.visitors) * 100))}%` }}
                  />
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-neutral-400">
        {formatNumber(totalV)} visitors · {totalS} signups attributed
      </p>
    </div>
  );
}
