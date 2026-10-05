import { formatNumber } from "../lib/format";

// Web-app funnel: PostHog
// visitors -> user_signed_up -> onboarding_completed -> api_key_copied, then
// paid subscribers (Stripe, RevenueCat, ...). Same 30 Nairobi days as the Web chart. Bars scale to
// the widest step with a floor so small steps stay visible; the arrow between
// rows is the step-to-step conversion.

export type FunnelStep = { label: string; value: number; color: string };

function pct(a: number, b: number): string {
  if (!b) return "—";
  const v = (a / b) * 100;
  return `${v >= 10 || v === 0 ? v.toFixed(0) : v.toFixed(1)}%`;
}

export function WebFunnel({ steps, days = 30 }: { steps: FunnelStep[]; days?: number }) {
  if (steps.length === 0 || steps[0].value <= 0) return null;
  const max = Math.max(...steps.map((s) => s.value), 1);
  const first = steps[0].value;
  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="card-title">Web funnel</h2>
        <p className="text-[11px] text-neutral-400">last {days} days</p>
      </div>
      <ol className="mt-3 space-y-2.5">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].value : null;
          return (
            <li key={s.label}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-neutral-700 dark:text-neutral-200">{s.label}</span>
                <span className="tabular-nums text-neutral-500">
                  <span className="num font-semibold text-neutral-900 dark:text-neutral-100">
                    {formatNumber(s.value)}
                  </span>
                  {prev != null ? (
                    <span className="ml-2 text-neutral-400" title={`${pct(s.value, prev)} of the step above`}>
                      ↳ {pct(s.value, prev)}
                    </span>
                  ) : null}
                  {i > 0 ? (
                    <span className="ml-2 text-neutral-400/70" title="of visitors">
                      ({pct(s.value, first)} of visitors)
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-black/[.05] dark:bg-white/[.08]">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${Math.max(2, (s.value / max) * 100)}%`, background: s.color }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
