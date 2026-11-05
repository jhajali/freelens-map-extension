// Traffic particles on a link: count and speed follow the rate, within a page-wide budget.
export const PARTICLE_BUDGET = 300;

export function particlesFor(rate: number, reduced: boolean): { count: number; durSec: number } {
  return {
    count: reduced ? 0 : rate > 0 ? Math.min(1 + Math.floor(rate * 2), 4) : 0,
    // half-second tiers: a live rate must not rewrite dur/begin on running animations
    durSec: Math.min(5, Math.max(0.9, Math.round((5 / (1 + rate)) * 2) / 2)),
  };
}

/** Particles per link id: the busiest links first, until the budget is spent. */
export function allot(links: { id: string; rate: number }[], reduced: boolean, budget = PARTICLE_BUDGET) {
  const out = new Map<string, number>();
  for (const l of [...links].sort((a, b) => b.rate - a.rate)) {
    const n = Math.min(particlesFor(l.rate, reduced).count, budget);
    budget -= n;
    out.set(l.id, n);
  }
  return out;
}

export const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Particles({ path, color, count, dur }: { path: string; color: string; count: number; dur: number }) {
  return Array.from({ length: count }, (_, i) => (
    <circle key={i} r="2.6" style={{ pointerEvents: "none", fill: color, filter: `drop-shadow(0 0 3px ${color})` }}>
      <animateMotion dur={`${dur}s`} begin={`${(-i * dur) / count}s`} repeatCount="indefinite" path={path} />
    </circle>
  ));
}
