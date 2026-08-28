"use client";

import { useState } from "react";
import { chipClass, formatDies, statusLabel } from "../dates.ts";
import { PROVIDER, shortId } from "../site.ts";
import { applyFilters, type Filters, type RegisterEntry } from "./filters.ts";

const PROVIDERS: Array<[Filters["provider"], string]> = [
  ["all", "all providers"],
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["google", "Google"],
];
const STATUSES: Array<[Filters["status"], string]> = [
  ["all", "dead and dying"],
  ["dead", "dead"],
  ["dying", "dying"],
];
const SORTS: Array<[Filters["sort"], string]> = [
  ["dies", "sort by date"],
  ["files", "sort by files"],
];

const COLUMNS = 6;

function searchUrl(query: string): string {
  return `https://github.com/search?q=${encodeURIComponent(`"${query}"`)}&type=code`;
}

/**
 * The whole registry, filtered in the browser. Every number here was computed
 * on the server; the client only picks and orders.
 */
export function Register({ entries }: { entries: RegisterEntry[] }) {
  const [filters, setFilters] = useState<Filters>({ provider: "all", status: "all", sort: "dies", q: "" });
  const shown = applyFilters(entries, filters);
  // A rotted replacement is itself a register row, so its chip reads that
  // row's server-computed days rather than running a clock in the browser.
  const daysById = new Map(entries.map((e) => [e.row.id, e.days]));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="Provider"
          value={filters.provider}
          options={PROVIDERS}
          onChange={(provider) => setFilters({ ...filters, provider })}
        />
        <Select
          label="Status"
          value={filters.status}
          options={STATUSES}
          onChange={(status) => setFilters({ ...filters, status })}
        />
        <Select label="Sort" value={filters.sort} options={SORTS} onChange={(sort) => setFilters({ ...filters, sort })} />
        <input
          type="text"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          placeholder="filter by id"
          aria-label="Filter by id"
          autoComplete="off"
          spellCheck={false}
          className="input min-w-[12rem] flex-1"
        />
      </div>
      <p className="label mt-3 text-ink-muted">
        {shown.length} of {entries.length} rows
      </p>

      <div className="panel mt-4 overflow-x-auto">
        <table className="w-full min-w-[920px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[9%]" />
            <col className="w-[24%]" />
            <col className="w-[8%]" />
            <col className="w-[17%]" />
            <col />
          </colgroup>
          <thead>
            <tr className="label border-b border-rule text-left text-ink-muted">
              <th className="px-4 py-2.5 font-normal">identifier</th>
              <th className="px-4 py-2.5 font-normal">provider</th>
              <th className="px-4 py-2.5 font-normal">dies</th>
              <th className="px-4 py-2.5 font-normal">files</th>
              <th className="px-4 py-2.5 font-normal">replacement</th>
              <th className="px-4 py-2.5 font-normal">source</th>
            </tr>
          </thead>
          <tbody className="font-mono text-[13px]">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS} className="px-4 py-6 text-ink-muted">
                  no rows match
                </td>
              </tr>
            ) : (
              shown.map((e) => {
                const rottedDays = e.rotted ? (daysById.get(e.rotted.id) ?? null) : null;
                return (
                  <tr key={e.row.id} className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                    <td className="break-words px-4 py-3">
                      <span className={e.retired ? "struck" : "text-ink"}>{shortId(e.row)}</span>
                      {e.query !== null && (
                        <a
                          href={searchUrl(e.query)}
                          title={e.query}
                          className="label mt-1 block text-ink-muted underline decoration-rule-strong underline-offset-2 hover:text-ink"
                        >
                          github search ↗
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{PROVIDER[e.row.provider]}</td>
                    <td className={`px-4 py-3 tabular-nums ${e.retired ? "text-ink-muted" : "text-ink"}`}>
                      <span className="whitespace-nowrap">{e.row.dies ? formatDies(e.row.dies) : "no date"}</span>
                      <span
                        className={`label ml-2 inline-block whitespace-nowrap px-1.5 py-0.5 ${chipClass(e.days, e.retired)}`}
                      >
                        {e.retired ? "retired" : statusLabel(e.row, e.days)}
                      </span>
                      {e.row.dies_is_earliest_possible && !e.retired && (
                        <span className="label ml-2 whitespace-nowrap text-ink-muted">earliest possible</span>
                      )}
                    </td>
                    <td
                      className="px-4 py-3 tabular-nums text-ink"
                      title={e.countedAt ? `counted ${e.countedAt.slice(0, 10)}` : undefined}
                    >
                      {e.files !== null ? (
                        e.files.toLocaleString("en-US")
                      ) : (
                        <span className="label text-ink-muted">not counted</span>
                      )}
                    </td>
                    <td className="break-words px-4 py-3 text-ink-secondary">
                      {e.row.replacement_id ? (
                        <>
                          <code className={e.rotted?.status === "retired" ? "struck" : "text-ink"}>
                            {e.row.replacement_id.split(":").pop()}
                          </code>
                          {e.rotted && (
                            <span
                              className={`label ml-2 inline-block whitespace-nowrap px-1.5 py-0.5 ${chipClass(rottedDays, e.rotted.status === "retired")}`}
                            >
                              {statusLabel(e.rotted, rottedDays)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-ink-muted">none announced</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={e.row.source_url}
                        className="label break-all text-ink-muted underline decoration-rule-strong underline-offset-2 hover:text-ink"
                      >
                        {new URL(e.row.source_url).hostname}
                      </a>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* selectedIndex, not e.target.value: the option list is the type, so no cast. */
function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(options[e.target.selectedIndex][0])}
      className="input w-auto"
    >
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}
