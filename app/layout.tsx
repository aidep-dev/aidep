import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Archivo, Geist_Mono } from "next/font/google";
import { themeScript } from "./theme.tsx";
import "./globals.css";

// The width axis is on so headlines can sit at 112% while body copy stays at
// 100%, one family reading as two voices without a second sans.
const display = Archivo({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["wdth"],
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "aidep",
  description:
    "aidep tracks every dated OpenAI, Anthropic and Google model and API retirement, finds them in your repo, opens the migration PR, and proves behavior held with an eval run in your own CI.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // themeScript stamps data-theme before paint, so the server HTML and the
    // first client HTML differ by that attribute on purpose.
    <html
      lang="en"
      className={`${display.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
