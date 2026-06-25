"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type Game = {
  slug: string;
  title: string;
  tagline: string;
  category: string;
  categoryColor: string;
  status: "live" | "soon";
  seats: string;
  href?: string;
  tags: string[];
};

export function Catalog({ games }: { games: Game[] }) {
  const categories = useMemo(
    () => ["All", ...Array.from(new Set(games.map((g) => g.category)))],
    [games],
  );
  const [active, setActive] = useState("All");
  const shown = active === "All" ? games : games.filter((g) => g.category === active);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => {
          const on = c === active;
          const count = c === "All" ? games.length : games.filter((g) => g.category === c).length;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setActive(c)}
              className={`rounded-full border px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition ${
                on
                  ? "border-[var(--amber)]/50 bg-[var(--amber)]/10 text-[var(--amber-soft)]"
                  : "border-white/10 text-neutral-400 hover:border-white/30 hover:text-foreground"
              }`}
            >
              {c}
              <span className={`ml-1.5 ${on ? "text-[var(--amber)]/60" : "text-neutral-600"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((g, i) => (
          <Card key={g.slug} g={g} index={i} />
        ))}
      </div>
    </>
  );
}

function Card({ g, index }: { g: Game; index: number }) {
  const live = g.status === "live";

  const inner = (
    <article
      className={`group relative flex h-full flex-col rounded-2xl border p-6 transition-all duration-300 ${
        live
          ? "border-[var(--amber)]/30 bg-[#0e0b07] hover:-translate-y-1 hover:border-[var(--amber)]/60 hover:shadow-2xl hover:shadow-black/50"
          : "border-white/[0.07] bg-[#0a0908] hover:border-white/15"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs tracking-[0.2em] text-neutral-600">
          {String(index + 1).padStart(2, "0")}
        </span>
        {live ? (
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--amber)]/[0.12] px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--amber-soft)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--amber)] live-dot" />
            Live
          </span>
        ) : (
          <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            Soon
          </span>
        )}
      </div>

      <h3
        className={`mt-7 flex items-center gap-2 font-display text-3xl ${
          live ? "text-foreground" : "text-neutral-300"
        }`}
      >
        {g.title}
        {live && (
          <span className="text-[var(--amber)] opacity-0 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100">
            →
          </span>
        )}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-neutral-500">{g.tagline}</p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {g.tags.map((t) => (
          <span
            key={t}
            className="rounded-full border border-white/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500"
          >
            {t}
          </span>
        ))}
      </div>

      <div className="mt-7 flex items-center justify-between border-t border-white/[0.06] pt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-neutral-500">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: g.categoryColor }} />
          {g.category}
        </span>
        <span>{g.seats} seats</span>
      </div>
    </article>
  );

  if (live && g.href) {
    return (
      <Link href={g.href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return <div className="h-full cursor-default select-none opacity-70">{inner}</div>;
}
