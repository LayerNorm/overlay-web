import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "@overlay/chat-react/chat-surface.css";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/shared/app/theme-init-script";

export const metadata: Metadata = {
  metadataBase: new URL("https://getoverlay.io"),
  title: "overlay",
  description:
    "Overlay is the unified AI interaction layer: chat, voice notes, browser tasks, agents, automations, context, and content generation in one open-source workspace.",
  keywords: [
    "AI workspace",
    "AI interaction layer",
    "open source AI",
    "AI agents",
    "browser agent",
    "voice notes",
    "Overlay",
    "ChatGPT alternative",
    "Claude alternative",
    "Perplexity alternative",
  ],
  icons: {
    icon: [
      { url: "/icon.png", sizes: "64x64", type: "image/png" },
    ],
  },
  openGraph: {
    title: "overlay — the unified AI interaction layer",
    description:
      "Open-source AI workspace for chat, voice notes, browser tasks, agents, automations, context, and content generation.",
    type: "website",
    url: "https://getoverlay.io",
    images: [
      {
        url: "https://getoverlay.io/assets/overlay-share-linkedin-thumb.png",
        width: 1200,
        height: 627,
        alt: "overlay logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "overlay — the unified AI interaction layer",
    description:
      "Open-source AI workspace for chat, voice notes, browser tasks, agents, automations, context, and content generation.",
    images: ["https://getoverlay.io/assets/overlay-share-x-thumb.png"],
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
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
