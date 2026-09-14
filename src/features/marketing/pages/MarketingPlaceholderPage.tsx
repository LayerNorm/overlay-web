"use client";

/**
 * Minimal placeholder for marketing surfaces that are announced but not yet
 * built (blog, changelog, self-hosting). Keeps nav/footer links honest —
 * real pages replace these as they ship.
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MarketingFooter } from "@/features/marketing/components/MarketingFooter";
import { StaticMarketingShell } from "@/features/marketing/components/StaticMarketingShell";
import { marketingSerifStyle } from "@/features/marketing/lib/marketingLayout";

export function MarketingPlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <StaticMarketingShell>
      <main className="flex-1 px-6 py-28 md:px-10 md:py-40">
        <div className="mx-auto max-w-2xl">
          <h1
            className="text-4xl leading-[1.05] tracking-tight md:text-6xl"
            style={marketingSerifStyle()}
          >
            {title}
          </h1>
          <p className="mt-6 text-base leading-8 text-[var(--muted)] md:text-lg">
            {description}
          </p>
          <p className="mt-4 text-sm text-[var(--muted-light)]">
            Nothing here yet — this page is on its way.
          </p>
          <Link
            href="/home"
            className="mt-10 inline-flex items-center gap-2 text-sm font-medium text-[var(--foreground)] underline decoration-[var(--border)] underline-offset-4 transition-colors hover:decoration-[var(--foreground)]"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
            Back to home
          </Link>
        </div>
      </main>
      <MarketingFooter />
    </StaticMarketingShell>
  );
}
