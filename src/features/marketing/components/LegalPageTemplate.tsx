"use client";

import Link from "next/link";
import { MarketingPageHead, StaticMarketingShell } from "@/features/marketing/components/StaticMarketingShell";

export type LegalSection = {
  title: string;
  body: string | string[];
};

function slugFor(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Every legal page: a page head, then sticky contents beside hairline-separated sections. */
export function LegalPageTemplate({
  label,
  title,
  updated,
  intro,
  sections,
  crossLink,
}: {
  label: string;
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  crossLink: { href: string; label: string };
}) {
  return (
    <StaticMarketingShell>
      <main>
        <MarketingPageHead label={label} title={title} lead={intro}>
          <p className="meta-line">Last updated: {updated}</p>
          <p className="note-card">
            Counsel-review draft. LayerNorm is preparing these terms for launch; a qualified lawyer must approve the final version before LayerNorm relies on it as a mature commercial agreement.
          </p>
        </MarketingPageHead>

        <section className="sec">
          <div className="doc">
            <nav className="toc" aria-label="On this page">
              {sections.map((section) => (
                <a key={section.title} href={`#${slugFor(section.title)}`}>
                  {section.title}
                </a>
              ))}
            </nav>
            <article>
              <div className="doc-body">
                {sections.map((section) => (
                  <section id={slugFor(section.title)} key={section.title} className="doc-sec">
                    <h2>{section.title}</h2>
                    {(Array.isArray(section.body) ? section.body : [section.body]).map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </section>
                ))}
              </div>
              <p className="doc-foot">
                Questions? Email <a href="mailto:divyansh@layernorm.co">divyansh@layernorm.co</a>. See also the{" "}
                <Link href={crossLink.href}>{crossLink.label}</Link>.
              </p>
            </article>
          </div>
        </section>
      </main>
    </StaticMarketingShell>
  );
}
