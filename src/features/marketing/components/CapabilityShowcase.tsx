"use client";

import { useState } from "react";
import {
  CapabilityPanel,
  type CapabilityPanelKey,
} from "@/features/marketing/components/MarketingShowcase";
import { marketingSerifStyle } from "@/features/marketing/lib/marketingLayout";

const TABS: Array<{ key: CapabilityPanelKey; label: string; blurb: string }> = [
  {
    key: "chat",
    label: "Chat",
    blurb: "One workspace for models, files, memory, and tools.",
  },
  {
    key: "models",
    label: "Models",
    blurb: "Hosted, private, local, or bring your own keys—from one interface.",
  },
  {
    key: "knowledge",
    label: "Knowledge",
    blurb: "Connect institutional files and memory without rebuilding context.",
  },
  {
    key: "tools",
    label: "Tools",
    blurb: "Agents can act through approved tools; people stay in control.",
  },
  {
    key: "deploy",
    label: "Deploy",
    blurb: "Hosted, private cloud, or on-prem—same product, your infrastructure.",
  },
];

/**
 * Tabbed product placeholder: swaps CSS UI shells for Chat / Models /
 * Knowledge / Tools / Deploy. Keeps the landing page product-led without
 * relying on stale screenshots.
 */
export function CapabilityShowcase() {
  const [active, setActive] = useState<CapabilityPanelKey>("chat");
  const current = TABS.find((tab) => tab.key === active) ?? TABS[0];

  return (
    <div>
      <div
        role="tablist"
        aria-label="Product capabilities"
        className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-1"
      >
        {TABS.map((tab) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(tab.key)}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                selected
                  ? "bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
              style={marketingSerifStyle()}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{current.blurb}</p>
      <div className="mt-5" role="tabpanel">
        <CapabilityPanel panel={active} />
      </div>
    </div>
  );
}
