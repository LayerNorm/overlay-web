import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "katex/dist/katex.min.css";
import "@overlay/chat-react/chat-surface.css";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/shared/app/theme-init-script";
import { NativeTitleTooltips } from "@/components/providers/NativeTitleTooltips";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://getoverlay.io"),
  title: {
    default: "Overlay: The control plane for AI employees",
    template: "%s | Overlay",
  },
  description:
    "Overlay is the control plane for AI employees. Create, deploy, and manage every agent in one workspace. Bring your own agents, or run Overlay's, across chat, Slack, Telegram, iMessage, and the web.",
  applicationName: "Overlay",
  keywords: [
    "control plane for AI employees",
    "AI employees",
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
    title: "Overlay: The control plane for AI employees",
    description:
      "One workspace to create, deploy, and manage every AI agent. Bring your own agents or run Overlay's, across chat, Slack, Telegram, iMessage, and the web.",
    type: "website",
    url: "https://getoverlay.io",
    siteName: "Overlay",
    locale: "en_US",
    images: [
      {
        url: "https://getoverlay.io/assets/overlay-share-linkedin-thumb.png",
        width: 1200,
        height: 627,
        alt: "Overlay: The control plane for AI employees",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Overlay: The control plane for AI employees",
    description:
      "One workspace to create, deploy, and manage every AI agent. Bring your own agents or run Overlay's, across chat, Slack, Telegram, iMessage, and the web.",
    images: ["https://getoverlay.io/assets/overlay-share-linkedin-thumb.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={geist.variable} suppressHydrationWarning>
      <head>
        {/* Fetch the lockup face up front so the boot loader and landing
            lockup never paint a fallback serif first. */}
        <link
          rel="preload"
          href="/assets/fonts/Libre_Baskerville/static/LibreBaskerville-Regular.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased bg-background text-foreground">
        {children}
        <NativeTitleTooltips />
      </body>
    </html>
  );
}
