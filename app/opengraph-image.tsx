import { ImageResponse } from "next/og";

/**
 * The share card: the dying mark and the hero line on dark paper. Colours
 * are the dark theme tokens from DESIGN.md, written as hex because satori
 * does not read oklch.
 */
export const alt = "aidep: the model deprecation tracker that opens the PR";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#1b1a17";
const INK = "#efede8";
const MUTED = "#8a867d";

const HEADLINE = "The model deprecation tracker that opens the PR.";

/** The display face the site uses, fetched per the next/og docs pattern. On
 * any failure satori's default sans renders the card instead of the build
 * failing. */
async function newsreader(): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(
        "https://fonts.googleapis.com/css2?family=Newsreader:opsz@6..72",
        { headers: { "user-agent": "Mozilla/5.0" } },
      )
    ).text();
    const url = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1];
    if (url === undefined) return null;
    const res = await fetch(url);
    return res.ok ? res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function Image() {
  const font = await newsreader();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: PAPER,
          color: INK,
          fontFamily: font ? "Newsreader" : "serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="56" height="56" viewBox="0 0 256 256">
            <clipPath id="c">
              <rect x="0" y="0" width="256" height="152" />
            </clipPath>
            <circle cx="128" cy="152" r="64" fill={INK} clipPath="url(#c)" />
            <rect x="16" y="146" width="224" height="12" fill={INK} />
          </svg>
          <div style={{ fontSize: 36, letterSpacing: 1 }}>aidep</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 92, lineHeight: 0.95, letterSpacing: -2 }}>
            {HEADLINE}
          </div>
          <div style={{ fontSize: 28, color: MUTED }}>
            every openai, anthropic and google retirement · dated · sourced
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font ? [{ name: "Newsreader", data: font, style: "normal" }] : [],
    },
  );
}
