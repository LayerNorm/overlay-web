import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "@overlay/chat-react/chat-surface.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://getoverlay.io"),
  title: {
    default: "Overlay: the control plane for AI agents",
    template: "%s — Overlay",
  },
  description:
    "Overlay is the control plane for AI agents — create, deploy, and manage every agent in one workspace. Bring your own agents, or run Overlay's, across chat, Slack, Telegram, iMessage, and the web.",
  applicationName: "Overlay",
  keywords: [
    "control plane for AI agents",
    "AI agent platform",
    "unify AI agents",
    "run all agents in one place",
    "agent orchestration",
    "AI agent workspace",
    "multi-agent platform",
    "AI agents",
    "Codex",
    "Claude Code",
    "Overlay",
    "open source AI",
  ],
  authors: [{ name: "LayerNorm", url: "https://layernorm.co" }],
  creator: "LayerNorm",
  publisher: "LayerNorm Inc",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/icon.png", sizes: "64x64", type: "image/png" },
    ],
  },
  openGraph: {
    title: "Overlay: the control plane for AI agents",
    description:
      "One workspace to create, deploy, and manage every AI agent — bring your own agents or run Overlay's, across chat, Slack, Telegram, iMessage, and the web.",
    type: "website",
    url: "https://getoverlay.io",
    siteName: "Overlay",
    locale: "en_US",
    images: [
      {
        url: "https://getoverlay.io/assets/overlay-share-linkedin-thumb.png",
        width: 1200,
        height: 627,
        alt: "Overlay — the control plane for AI agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Overlay: the control plane for AI agents",
    description:
      "One workspace to create, deploy, and manage every AI agent — bring your own agents or run Overlay's, across chat, Slack, Telegram, iMessage, and the web.",
    images: ["https://getoverlay.io/assets/overlay-share-linkedin-thumb.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var raw = window.localStorage.getItem('overlay.app.settings');
                  if (!raw) return;
                  var theme = JSON.parse(raw).theme;
                  if (theme === 'light' || theme === 'dark') {
                    document.documentElement.dataset.theme = theme;
                    document.documentElement.style.colorScheme = theme;
                  }
                } catch (_) {}
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
