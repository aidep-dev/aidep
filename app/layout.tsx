import type { Metadata } from "next";
import { Newsreader, Public_Sans } from "next/font/google";
import { themeScript } from "./theme.tsx";
import "./globals.css";

const display = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const body = Public_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "aidep",
  description:
    "aidep knows every OpenAI, Anthropic, and Google deprecation, finds them in your repo, opens the migration PR, and proves behavior held with an eval run in your own CI.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // themeScript stamps data-theme before paint, so the server HTML and the
    // first client HTML differ by that attribute on purpose.
    <html
      lang="en"
      className={`${display.variable} ${body.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
