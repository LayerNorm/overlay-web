"use client";

import Link from "next/link";
import { MarketingPageHead, StaticMarketingShell } from "@/features/marketing/components/StaticMarketingShell";
import type { ComparePage } from "./comparePages";

import "./compare.css";

function slugFor(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * A comparison page: a direct answer first (what answer engines quote), then a
 * comparison table, sections, FAQ and sources. Uses the legal-page doc layout.
 */
export function ComparePageView({ page }: { page: ComparePage }) {
  const toc = [
    ...(page.table ? ["At a glance"] : []),
    ...page.sections.map((section) => section.title),
    "FAQ",
    "Sources",
  ];

  return (
    <StaticMarketingShell>
      <main>
        <MarketingPageHead label="Compare" title={page.title} lead={page.answer}>
          <p className="meta-line">Facts checked {page.checked}. Competitor details come from their public pages, linked below.</p>
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            <Link className="btn primary" href="/app">Try Overlay free</Link>
            <a className="btn ghost" href="https://github.com/LayerNorm/overlay-web">View source</a>
          </div>
        </MarketingPageHead>

        <section className="sec">
          <div className="doc">
            <nav className="toc" aria-label="On this page">
              {toc.map((title) => (
                <a key={title} href={`#${slugFor(title)}`}>{title}</a>
              ))}
            </nav>
            <article>
              <div className="doc-body">
                {page.table ? (
                  <section id="at-a-glance" className="doc-sec">
                    <h2>At a glance</h2>
                    <div className="compare-table-wrap">
                      <table className="compare-table">
                        <thead>
                          <tr>
                            <th scope="col"></th>
                            <th scope="col">Overlay</th>
                            <th scope="col">{page.table.otherLabel}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {page.table.rows.map((row) => (
                            <tr key={row.label}>
                              <th scope="row">{row.label}</th>
                              <td>{row.overlay}</td>
                              <td>{row.other}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}

                {page.sections.map((section) => (
                  <section id={slugFor(section.title)} key={section.title} className="doc-sec">
                    <h2>{section.title}</h2>
                    {section.body.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </section>
                ))}

                <section id="faq" className="doc-sec">
                  <h2>FAQ</h2>
                  {page.faq.map((item) => (
                    <div key={item.q}>
                      <h3 className="compare-q">{item.q}</h3>
                      <p>{item.a}</p>
                    </div>
                  ))}
                </section>

                <section id="sources" className="doc-sec">
                  <h2>Sources</h2>
                  <ul className="compare-sources">
                    {page.sources.map((source) => (
                      <li key={source.href}>
                        <a href={source.href}>{source.label}</a>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
              <p className="doc-foot">
                Something out of date? Email <a href="mailto:support@overlay.works">support@overlay.works</a>. See all{" "}
                <Link href="/compare">comparisons</Link>.
              </p>
            </article>
          </div>
        </section>
      </main>
    </StaticMarketingShell>
  );
}

export function CompareIndexView({ pages }: { pages: Pick<ComparePage, "slug" | "title" | "description">[] }) {
  return (
    <StaticMarketingShell>
      <main>
        <MarketingPageHead
          label="Compare"
          title="Overlay compared"
          lead="How Overlay, the open-source control plane for AI employees, compares with Devin, OpenHands, Lindy and other AI agent platforms."
        />
        <section className="sec">
          <div className="doc-body" style={{ margin: "0 auto" }}>
            {pages.map((page) => (
              <section key={page.slug} className="doc-sec">
                <h2><Link href={`/compare/${page.slug}`}>{page.title}</Link></h2>
                <p>{page.description}</p>
              </section>
            ))}
          </div>
        </section>
      </main>
    </StaticMarketingShell>
  );
}
