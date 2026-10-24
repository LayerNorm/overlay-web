"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { GithubMark } from "@/features/marketing/landing/GithubMark";
import { useAuth } from "@/contexts/AuthContext";
import { MarketingPageHead, StaticMarketingShell } from "@/features/marketing/components/StaticMarketingShell";
import { MARKETING_GITHUB_URL, getMarketingAppHref } from "@/shared/marketing/marketing";

const PRINCIPLES: Array<{ title: string; body: string }> = [
  {
    title: "Privacy",
    body: "The interface closest to your work should respect where that work lives. Data flows, model access, and retention should be visible and configurable — not hidden behind a vendor's roadmap.",
  },
  {
    title: "Openness",
    body: "Teams should be able to inspect, self-host, extend, and change the system they depend on. Open source is not a licensing detail; it is the architectural basis for sovereignty.",
  },
  {
    title: "Control",
    body: "Model choice, data flow, and workflow policy should be configurable, not dictated by one vendor. The organization decides what intelligence can access and where the results are stored.",
  },
  {
    title: "Simplicity",
    body: "The product should feel like a tool you use every day, not a maze of disconnected AI accounts. One workspace, one context, one interface — understandable and adaptable.",
  },
];

export default function ManifestoPage() {
  const { isAuthenticated } = useAuth();
  const appHref = getMarketingAppHref(isAuthenticated);

  return (
    <StaticMarketingShell>
      <main>
        <MarketingPageHead
          label="Manifesto"
          title="AI should amplify human potential, not replace it."
          lead="Overlay exists because the best models, tools, files, and workflows should meet in one open interface that people and institutions can actually control."
        />

        <section className="sec">
          <div className="head">
            <h2 className="h2">What we believe</h2>
          </div>
          <div className="grid2">
            {PRINCIPLES.map((principle, i) => (
              <div className="cell" key={principle.title}>
                <span className="num">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="h3">{principle.title}</h3>
                <p className="body">{principle.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="sec">
          <p className="sign">— LayerNorm</p>
          <div className="actions left">
            <Link className="btn primary" href={appHref}>
              Open app <ArrowRight className="i go" />
            </Link>
            <a className="btn ghost" href={MARKETING_GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <GithubMark /> View source
            </a>
          </div>
        </section>
      </main>
    </StaticMarketingShell>
  );
}
