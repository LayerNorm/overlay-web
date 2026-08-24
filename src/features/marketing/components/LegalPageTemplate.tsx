"use client";

import Link from "next/link";
import { LandingThemeProvider } from "@/contexts/LandingThemeContext";
import { MarketingFooter } from "@/features/marketing/components/MarketingFooter";
import { StaticMarketingShell } from "@/features/marketing/components/StaticMarketingShell";

export type LegalSection = {
  title: string;
  body: string;
};

function slugFor(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function LegalPageInner({
  label,
  title,
  updated,
  intro,
  sections,
  crossLink,
  embedded = false,
}: {
  embedded?: boolean;
  label: string;
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  crossLink: { href: string; label: string };
}) {
  const content = (
      <main className="min-h-full px-5 py-16 md:px-8 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[220px_minmax(0,760px)]">
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--muted-light)]">{label}</p>
              <nav className="mt-6 grid gap-2 text-sm text-[var(--muted)]">
                {sections.map((section) => (
                  <a key={section.title} href={`#${slugFor(section.title)}`} className="transition-colors hover:text-[var(--foreground)]">
                    {section.title}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          <article>
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--muted-light)] lg:hidden">{label}</p>
            <h1 className="mt-4 text-4xl tracking-tight md:text-6xl">{title}</h1>
            <p className="mt-4 text-sm text-[var(--muted-light)]">Last updated: {updated}</p>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-[var(--muted)]">{intro}</p>

            <div className="mt-12 divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {sections.map((section) => (
                <section id={slugFor(section.title)} key={section.title} className="py-8">
                  <h2 className="text-2xl tracking-tight">{section.title}</h2>
                  <p className="mt-4 text-base leading-8 text-[var(--muted)]">{section.body}</p>
                </section>
              ))}
            </div>

            <p className="mt-10 text-sm leading-6 text-[var(--muted)]">
              Questions? Email{" "}
              <a href="mailto:divyansh@layernorm.co" className="underline underline-offset-4">
                divyansh@layernorm.co
              </a>
              . See also the{" "}
              <Link href={crossLink.href} className="underline underline-offset-4">
                {crossLink.label}
              </Link>
              .
            </p>
          </article>
        </div>
      </main>
  );

  if (embedded) return content;

  return (
    <StaticMarketingShell>
      {content}
      <MarketingFooter />
    </StaticMarketingShell>
  );
}

export function LegalPageTemplate(props: {
  embedded?: boolean;
  label: string;
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  crossLink: { href: string; label: string };
}) {
  return (
    <LandingThemeProvider>
      <LegalPageInner {...props} />
    </LandingThemeProvider>
  );
}
