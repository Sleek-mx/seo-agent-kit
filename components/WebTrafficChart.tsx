"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
export type DailyCount = { date: string; count: number };
import { formatNumber } from "../lib/format";

function parseDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function shortLabel(date: string): string {
  return parseDay(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Every day gets a tick — keep labels
// narrow enough to fit 30 across: bare day number, with the month named on
// the first tick and on each month boundary.
function dayTick(date: string, index: number): string {
  const d = parseDay(date);
  return index === 0 || d.getDate() === 1 ? shortLabel(date) : String(d.getDate());
}

function fullLabel(date: string): string {
  return parseDay(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type Row = { date: string; customers: number; subscribers: number; traffic: number; signups: number };

type TipProps = {
  active?: boolean;
  payload?: { payload: Row }[];
  showTraffic?: boolean;
  showSignups?: boolean;
  showCustomers?: boolean;
  customerLabel?: string;
};

function ChartTooltip({
  active,
  payload,
  showTraffic,
  showSignups,
  showCustomers,
  customerLabel = "customer",
}: TipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-white/15 dark:bg-[var(--surface-2)]">
      <p className="font-medium text-neutral-500">{fullLabel(d.date)}</p>
      {showTraffic ? (
        <p className="mt-0.5 flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-[2px] bg-[#334155]" />
          <span className="text-base font-bold tabular-nums">{formatNumber(d.traffic)}</span>
          <span className="text-neutral-500">visitor{d.traffic === 1 ? "" : "s"}</span>
        </p>
      ) : null}
      {showCustomers ? (
        <p className="mt-0.5 flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-[2px] bg-[#94a3b8]" />
          <span className="text-base font-bold tabular-nums">{d.customers}</span>
          <span className="text-neutral-500">
            {customerLabel}
            {d.customers === 1 ? "" : "s"}
          </span>
        </p>
      ) : null}
      <p className="mt-0.5 flex items-center gap-1.5">
        <span className="inline-block size-2 rounded-[2px] bg-[#22d3ee]" />
        <span className="text-base font-bold tabular-nums">{d.subscribers}</span>
        <span className="text-neutral-500">new subscriber{d.subscribers === 1 ? "" : "s"}</span>
      </p>
      {showSignups ? (
        <p className="mt-0.5 flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-[2px] bg-[#a78bfa]" />
          <span className="text-base font-bold tabular-nums">{d.signups}</span>
          <span className="text-neutral-500">signup{d.signups === 1 ? "" : "s"}</span>
        </p>
      ) : null}
      {showTraffic && d.traffic > 0 ? (
        <p className="mt-0.5 text-[11px] text-neutral-500">
          <span className="font-semibold tabular-nums text-neutral-700 dark:text-neutral-300">
            {formatPct(d.subscribers / d.traffic)}
          </span>{" "}
          of visitors converted
        </p>
      ) : null}
    </div>
  );
}

function formatPct(r: number): string {
  const pct = r * 100;
  return `${pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

export type NewCustomersVariant = "web" | "ios";

export function WebTrafficChart({
  data,
  subscribers = [],
  traffic = [],
  signups = [],
  title,
  variant = "ios",
}: {
  data: DailyCount[];
  subscribers?: DailyCount[];
  traffic?: DailyCount[];
  /** Web only: PostHog user_signed_up per ET day. */
  signups?: DailyCount[];
  title?: string;
  /** web = visitors + web subs; ios = downloads + app-store subs. */
  variant?: NewCustomersVariant;
}) {
  const isWeb = variant === "web";
  const resolvedTitle = title ?? (isWeb ? "Web" : "iOS");
  const customerLabel = isWeb ? "customer" : "download";

  // Prefer the densest series for the x-axis spine so empty companion
  // series still get a full 30-day grid.
  const spine =
    data.length >= subscribers.length && data.length >= traffic.length
      ? data
      : subscribers.length >= traffic.length
        ? subscribers
        : traffic;

  const subsByDay = new Map(subscribers.map((d) => [d.date, d.count]));
  const trafficByDay = new Map(traffic.map((d) => [d.date, d.count]));
  const customersByDay = new Map(data.map((d) => [d.date, d.count]));
  const signupsByDay = new Map(signups.map((d) => [d.date, d.count]));
  const rows: Row[] = spine.map((d) => ({
    date: d.date,
    customers: customersByDay.get(d.date) ?? 0,
    subscribers: subsByDay.get(d.date) ?? 0,
    traffic: trafficByDay.get(d.date) ?? 0,
    signups: signupsByDay.get(d.date) ?? 0,
  }));

  const totalCustomers = rows.reduce((s, d) => s + d.customers, 0);
  const totalSubs = rows.reduce((s, d) => s + d.subscribers, 0);
  const totalTraffic = rows.reduce((s, d) => s + d.traffic, 0);
  const totalSignups = rows.reduce((s, d) => s + d.signups, 0);
  const showSignups = isWeb && signups.length > 0;
  const showTraffic = isWeb && traffic.length > 0;
  const showCustomers = !isWeb;
  const days = rows.length;
  // Unique gradient ids so two charts on one page don't clash (SVG defs).
  const gid = (name: string) => `${name}-${variant}`;

  const headline = isWeb
    ? formatNumber(totalTraffic || totalSubs)
    : formatNumber(totalCustomers || totalSubs);
  const headlineUnit = isWeb
    ? totalTraffic > 0
      ? "visitors"
      : "subscribers"
    : totalCustomers > 0
      ? "downloads"
      : "subscribers";

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="card-title">{resolvedTitle}</h2>
          <p className="num mt-2 text-2xl font-semibold tracking-tight">
            {headline}
            <span className="ml-2 text-xs font-normal text-neutral-400">
              {headlineUnit} · last {days} days
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] font-medium text-neutral-500 sm:flex-row sm:items-center sm:gap-3">
          {showTraffic ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-[#334155]" />
              visitors
              <span className="tabular-nums font-semibold text-neutral-700 dark:text-neutral-300">
                {formatNumber(totalTraffic)}
              </span>
            </span>
          ) : null}
          {showSignups ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-[#a78bfa]" />
              signups
              <span className="tabular-nums font-semibold text-neutral-700 dark:text-neutral-300">
                {formatNumber(totalSignups)}
              </span>
            </span>
          ) : null}
          {showCustomers ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-[#94a3b8]" />
              downloads
            </span>
          ) : null}
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-full bg-[#22d3ee]" />
            subscribers
            <span className="tabular-nums font-semibold text-neutral-700 dark:text-neutral-300">
              {formatNumber(totalSubs)}
            </span>
            {showTraffic && totalTraffic > 0 ? (
              <span className="tabular-nums text-neutral-400">
                ({formatPct(totalSubs / totalTraffic)} conv)
              </span>
            ) : null}
          </span>
        </div>
      </div>

      <div className="mt-3 h-[150px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={gid("fillNewCustomers")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a8b3c1" stopOpacity={1} />
                <stop offset="100%" stopColor="#64748b" stopOpacity={0.9} />
              </linearGradient>
              <linearGradient id={gid("fillNewSubscribers")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity={1} />
                <stop offset="100%" stopColor="#0891b2" stopOpacity={0.9} />
              </linearGradient>
              <linearGradient id={gid("fillSignups")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a78bfa" stopOpacity={1} />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.9} />
              </linearGradient>
              <linearGradient id={gid("fillWebTraffic")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#475569" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#1e293b" stopOpacity={0.85} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              strokeDasharray="3 3"
              stroke="rgba(130,130,130,0.18)"
            />
            <XAxis
              dataKey="date"
              tickFormatter={dayTick}
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
            />
            <XAxis dataKey="date" xAxisId="overlay" hide />
            <XAxis dataKey="date" xAxisId="traffic" hide />
            <XAxis dataKey="date" xAxisId="signups" hide />
            <YAxis hide />
            <YAxis
              yAxisId="traffic"
              hide
              domain={[0, (max: number) => Math.max(1, Math.ceil(max * 1.3))]}
            />
            <Tooltip
              content={
                <ChartTooltip
                  showTraffic={showTraffic}
                  showSignups={showSignups}
                  showCustomers={showCustomers}
                  customerLabel={customerLabel}
                />
              }
              cursor={{ fill: "rgba(34,211,238,0.10)" }}
            />
            {showTraffic ? (
              <Bar
                dataKey="traffic"
                xAxisId="traffic"
                yAxisId="traffic"
                fill={`url(#${gid("fillWebTraffic")})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
              />
            ) : null}
            {showCustomers ? (
              <Bar
                dataKey="customers"
                fill={`url(#${gid("fillNewCustomers")})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
              />
            ) : null}
            {/* Layered on the visitors axis, SAME width (height shows the
                difference, not width): visitors behind, signups (violet) in front, subscribers
                (cyan) in front of those. Floors 10px / 6px keep violet showing above cyan. */}
            {showSignups ? (
              <Bar
                dataKey="signups"
                xAxisId="signups"
                yAxisId="traffic"
                fill={`url(#${gid("fillSignups")})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
                minPointSize={(v) => ((v ?? 0) > 0 ? 10 : 0)}
              />
            ) : null}
            {/* Web: subscribers share the VISITORS axis so the cyan bar is the true
                share of that day's traffic (otherwise 1 sale drew a full-height
                bar on its own axis and read as 100% conversion). A sale is never
                invisible: nonzero days get a 3px floor. */}
            <Bar
              dataKey="subscribers"
              xAxisId="overlay"
              {...(showTraffic ? { yAxisId: "traffic" } : {})}
              fill={`url(#${gid("fillNewSubscribers")})`}
              maxBarSize={22}
              radius={[4, 4, 0, 0]}
              minPointSize={(v) => (showTraffic && (v ?? 0) > 0 ? (showSignups ? 6 : 3) : 0)}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
