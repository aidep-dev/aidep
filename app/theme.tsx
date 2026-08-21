"use client";

import { useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";

const KEY = "aidep-theme";

/**
 * Runs before first paint so a stored choice never flashes the wrong theme.
 * Readers on "system" store nothing, so the CSS media query handles them and
 * this script is a no-op. Wrapped in try/catch: localStorage throws outright in
 * some privacy modes rather than returning null.
 */
export const themeScript = `try{var t=localStorage.getItem("${KEY}");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

// The theme lives in localStorage and on <html>, not in React. A storage event
// only fires in *other* tabs, so writes in this one notify these listeners.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** The server has no localStorage, so it always renders the "system" label. */
function readOnServer(): Theme {
  return "system";
}

function write(next: Theme): void {
  const root = document.documentElement;
  if (next === "system") delete root.dataset.theme;
  else root.dataset.theme = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // storage unavailable: the attribute above still holds for this page view
  }
  for (const onChange of listeners) onChange();
}

const LABEL = { system: "Auto", light: "Light", dark: "Dark" } satisfies Record<Theme, string>;
const NEXT = { system: "light", light: "dark", dark: "system" } satisfies Record<Theme, Theme>;

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, readOnServer);

  return (
    <button
      type="button"
      onClick={() => write(NEXT[theme])}
      aria-label={`Theme: ${LABEL[theme].toLowerCase()}. Activate to switch to ${LABEL[NEXT[theme]].toLowerCase()}.`}
      className="text-ink-secondary hover:text-ink"
    >
      {LABEL[theme]}
    </button>
  );
}
