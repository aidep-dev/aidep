# The register

`/dead` lists every registry row with its provider, retirement date and status chip, public-file count from GitHub code search, replacement, and source. Filters, sort, and an id filter narrow the table in the browser; a count line says how many rows are showing. Below it, a second table lists every replacement that is itself already dying.

## Sub-features

- `register-count` the line "N of M rows" tracks the filters; M is the whole registry.
- `register-filter-id` the textbox filters on registry id or any api id, case-insensitive substring.
- `register-provider` the Provider select keeps one provider.
- `register-status` the Status select keeps dead (retired) or dying (everything else).
- `register-sort` sort by date (retired first, newest death first, then nearest date) or by files (counted rows first, most files first).
- `register-empty` no match shows one cell "no rows match" and "0 of M rows".
- `register-row` each row: identifier (struck when retired) with a "github search" link when the id is searchable, provider, dies date plus chip, files or "not counted", replacement (with its own chip when it is itself dying) or "none announced", source hostname.
- `register-rotted` the "Every replacement that is already dying" table under the register.

## How to get to it (user POV)

- Header link "register" on every marketing page.
- Landing page link "the full register, with a github search you can run per row" under the "already dead" table.
- Footer link "register".
- `/replacements` redirects here (`/dead#check`).

## Driving it with verify-aidep

Preconditions:

- Doctor is all PASS; `$URL` and `$ART` are set.
- Expected counts for this run, computed once and saved:

      curl -s $URL/api/registry | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const n=f=>r.filter(f).length;console.log(JSON.stringify({all:r.length,anthropic:n(x=>x.provider==="anthropic"),dead:n(x=>x.status==="retired"),sonnet:n(x=>x.id.includes("sonnet")||x.api_ids.some(a=>a.includes("sonnet")))}))})' | tee "$ART/register-expected.json"

  On 2026-08-28 that printed `{"all":199,"anthropic":21,"dead":136,"sonnet":5}`.

- **Reach the table.** Navigate to `$URL/dead`. Run `browser_navigate`, then `browser_snapshot`. The count line reads "<all> of <all> rows"; the comboboxes "Provider", "Status", "Sort" and the textbox "Filter by id" sit above the table.
- **Filter by id.** Type `sonnet` in the textbox "Filter by id". Run `browser_type` on it with `sonnet`, then `browser_snapshot`. The count line reads "<sonnet> of <all> rows" and every identifier cell contains "sonnet" (or the row's other api ids do).
- **Provider.** Clear the textbox and choose "Anthropic". Run `browser_fill_form` with the textbox "Filter by id" set to an empty value and the combobox "Provider" set to `Anthropic`, then `browser_snapshot`. The count reads "<anthropic> of <all> rows" and the provider column is all "Anthropic".
- **Status.** Set Provider back to "all providers" and Status to "dead". Run `browser_fill_form` with "Provider" `all providers` and "Status" `dead`, then `browser_snapshot`. The count reads "<dead> of <all> rows" and every chip reads "retired".
- **Sort.** Set Status to "dead and dying" and Sort to "sort by files". Run `browser_fill_form` with those two values, then `browser_snapshot`. Rows with a number in the files column come first, largest first; "not counted" rows follow in date order. Locally `exposure_counts` may hold only a couple of rows; the rule still shows.
- **Empty.** Type `zzzz` in "Filter by id". Run `browser_type` with `zzzz`, then `browser_snapshot`. The table body is one cell "no rows match" and the count reads "0 of <all> rows".
- **Row anatomy.** Clear the filter and read the first row. Run `browser_fill_form` with the textbox set to an empty value, then `browser_snapshot`. The first row is a retired one (struck identifier, "retired" chip), and a row with a searchable id carries a link "github search" whose href starts `https://github.com/search?q=`.
- **Rotted replacements.** In the same snapshot, under the heading "Every replacement that is already dying", the table has columns "dead or dying", "vendor says use", "which is", "source", and each "vendor says use" value also appears as an identifier in the register above.
- **Proof.** With the `sonnet` filter applied, run `browser_take_screenshot` with filename `$ART/register-filter.png` and `browser_snapshot` with filename `$ART/register-filter.aria.md`; `register-expected.json` from the precondition is the third artifact.

## Gotchas

- The page revalidates hourly and its file counts come from a daily snapshot; nothing here calls GitHub at request time.
- The H1 is "What is already dead, and what dies next." unless local `exposure_counts` has retired rows with files, in which case it leads with a file total. Either is correct.
- The selects are native `<select>`; `browser_fill_form` with type `combobox` and the option's visible text ("Anthropic", "dead", "sort by files") is the reliable way. `browser_type` into a select does nothing.
- The status filter is about retirement, not dates: a Google row past its earliest-possible date is still "dying".
- Every date chip moves daily; assert the chip text pattern, not the day count.
- The table needs 920px; at narrow viewports it scrolls inside its panel, so a viewport screenshot can cut columns. Use `fullPage` or the snapshot for column assertions.
