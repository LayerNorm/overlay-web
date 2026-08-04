import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "@overlay/chat-react/chat-surface.css";
import "./globals.css";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

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
      <head suppressHydrationWarning>
        <script
          id="overlay-theme-init"
          suppressHydrationWarning
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
