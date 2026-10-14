// QA route sweep for the Tailwind v4 upgrade. Connects to the running Chrome
// over CDP, visits each route, records HTTP status + console errors + style
// probes, and saves a screenshot per route to /tmp/qa-tw4/.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:3100';
const OUT = '/tmp/qa-tw4';
const ROUTES = process.argv[2]
  ? process.argv[2].split(',')
  : [
      '/',
      '/pricing',
      '/download',
      '/manifesto',
      '/changelog',
      '/self-hosting',
      '/blog',
      '/auth/sign-in',
      '/auth/sign-up',
      '/app',
      '/app/chat',
      '/app/agents',
      '/app/automations',
      '/app/files',
      '/app/notes',
      '/app/memories',
      '/app/outputs',
      '/app/settings',
      '/app/account',
      '/app/integrations',
    ];

const NOISE = [
  'favicon',
  'Download the React DevTools',
  'third-party cookie',
  'Convex',
  'WorkOS',
  'posthog',
  'PostHog',
  'ResizeObserver',
  '[vite]',
  'hmr',
  'HMR',
  'preload',
  'deprecation',
  'Sentry',
  'sentry',
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP('http://localhost:29229');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  const results = [];

  for (const route of ROUTES) {
    const errors = [];
    const onConsole = (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (NOISE.some((n) => t.includes(n))) return;
      errors.push(t.slice(0, 220));
    };
    page.on('console', onConsole);
    const resp = await page
      .goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .catch(() => null);
    await page.waitForTimeout(3500);
    const probe = await page
      .evaluate(() => {
        const body = getComputedStyle(document.body);
        const el = document.createElement('div');
        el.className = 'bg-background text-foreground rounded-sm shadow-xs';
        document.body.appendChild(el);
        const cs = getComputedStyle(el);
        const probe = {
          bgUtil: cs.backgroundColor,
          fgUtil: cs.color,
          radius: cs.borderRadius,
          shadow: cs.boxShadow,
        };
        el.remove();
        return {
          url: location.pathname,
          title: document.title.slice(0, 60),
          bodyBg: body.backgroundColor,
          bodyColor: body.color,
          theme: document.documentElement.dataset.theme || null,
          preset: document.documentElement.dataset.themePreset || null,
          ...probe,
        };
      })
      .catch((e) => ({ evalError: String(e?.message || e).slice(0, 120) }));
    const shot = `${OUT}/${route.replace(/\//g, '_') || 'root'}.png`;
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    page.off('console', onConsole);
    results.push({
      route,
      status: resp ? resp.status() : 'nav-fail',
      ...probe,
      errors: errors.slice(0, 5),
    });
  }
  await page.close();
  await browser.close();
  console.log(JSON.stringify(results, null, 1));
})().catch((e) => {
  console.error('FATAL', e.message.slice(0, 400));
  process.exit(1);
});
