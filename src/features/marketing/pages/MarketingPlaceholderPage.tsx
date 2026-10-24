"use client";

/**
 * Minimal placeholder for marketing surfaces that are announced but not yet
 * built (blog, changelog, self-hosting). Keeps nav/footer links honest —
 * real pages replace these as they ship.
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MarketingPageHead, StaticMarketingShell } from "@/features/marketing/components/StaticMarketingShell";

export function MarketingPlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <StaticMarketingShell>
      <main>
        <MarketingPageHead label="Coming soon" title={title} lead={description} tall>
          <p className="meta-line">Nothing here yet. This page is on its way.</p>
          <div className="actions">
            <Link className="btn ghost" href="/home">
              <ArrowLeft className="i" />
              Back to home
            </Link>
          </div>
        </MarketingPageHead>
      </main>
    </StaticMarketingShell>
  );
}
