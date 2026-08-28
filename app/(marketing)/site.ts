import type { RegistryRow } from "../../src/registry.ts";

export const PROVIDER: Record<RegistryRow["provider"], string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

/** "openai:model:gpt-4-turbo" -> "gpt-4-turbo" */
export function shortId(row: RegistryRow): string {
  return row.id.split(":").slice(2).join(":");
}

/** The GitHub App's install page, or the landing's waitlist while the App is private. */
export function installUrl(): string {
  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  return slug ? `https://github.com/apps/${slug}/installations/new` : "/#waitlist";
}
