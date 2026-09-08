# Look up an id

Paste a model id, an endpoint, or a param and aidep walks its announced replacements until it reaches one with no retirement on file, showing each hop's status and source. The box sits in the landing hero and again at `/dead#check`; both run in the browser against `/api/registry`.

## Sub-features

- `lookup-examples` an empty, focused box offers up to six real ids under "try one of these".
- `lookup-slash` pressing `/` anywhere outside a field focuses the box.
- `lookup-suggest` typing narrows the list to the closest registry rows, best match first.
- `lookup-chain` submitting a known id renders the chain: you, then each hop, then the end state.
- `lookup-pick` ArrowDown or ArrowUp plus Enter, or a click, fills the box with the picked id and runs it.
- `lookup-miss` an unknown id gets "is not in the registry", a "File a row" link, and the closest rows as buttons.
- `lookup-api` `/api/registry/<id>` returns the same chain any agent can read.

## How to get to it (user POV)

- Open `/`; the box is the first control under the headline.
- Open `/dead` and scroll to "Paste what your agent picked", or open `/dead#check`.
- Follow "check what yours picked" from the "Why not just ask my agent?" section of the landing page.
- Press `/` on either page.

## Driving it with verify-aidep

Preconditions:

- Doctor is all PASS; `$URL` and `$ART` are set as in the README.
- `curl -s $URL/api/registry/gpt-4-turbo` answers `"found":true`; its `end.api_id` is the expected last row of the chain below (`gpt-5.6-sol` on 2026-08-28).

- **Reach the box.** Navigate to `$URL/dead#check`. Run `browser_navigate` with that URL, then `browser_snapshot`. The snapshot has a combobox "Model id, endpoint or param" and a button "Check" under the heading "Paste what your agent picked".
- **Examples on focus.** Click the combobox. Run `browser_click` on it, then `browser_snapshot`. A listbox "Closest registry rows" is open; its first row reads "try one of these" and it lists up to six options, each a real api id with a status chip and a provider name.
- **Slash shortcut.** Press Escape, click the heading "Paste what your agent picked", press `/`. Run `browser_press_key` with `Escape`, `browser_click` on the heading, `browser_press_key` with `/`, then `browser_snapshot`. The combobox is marked active with no value (focus also reopens the examples list); no slash was typed.
- **Suggestions narrow.** Type `gpt-4-turbo`. Run `browser_type` on the combobox with text `gpt-4-turbo` and no submit, then `browser_snapshot`. The listbox leads with the option `gpt-4-turbo`; every option contains the typed text or its tokens in order.
- **Walk the chain.** Press Enter. Run `browser_press_key` with `Enter`, `browser_wait_for` with text `alive as far as we know`, then `browser_snapshot`. A list appears under the form: first item "you" then `gpt-4-turbo` with a status chip and a "source" link; last item "then" followed by the API's `end.api_id` and "alive as far as we know".
- **Pick with the keyboard.** Type `claude-3-5-sonnet`, press ArrowDown, press Enter. Run `browser_type` on the combobox with `claude-3-5-sonnet` (it replaces the value), `browser_press_key` with `ArrowDown`, then `Enter`, then `browser_snapshot`. The combobox value is the full id of the first suggestion (`claude-3-5-sonnet-20240620` on 2026-08-28: same match tier, equal length, registry order) and the chain's first row is that id with a "retired Oct 28, 2025" chip. The strike-through is visual: the screenshot carries it, the snapshot carries the chip text.
- **Miss, then the closest.** Type `gpt4turbo` and press Enter. Run `browser_type` with `gpt4turbo` and submit true, then `browser_snapshot`. The chain is replaced by "gpt4turbo is not in the registry", a link "File a row", and "Closest in the registry:" with a button `gpt-4-turbo`. Click that button with `browser_click`; the box reads `gpt-4-turbo` and the chain from the earlier step is back.
- **Cross-check the API.** Run `curl -s $URL/api/registry/gpt-4-turbo > "$ART/lookup-api.json"`. `found` is true, `chain[0].api_id` is `gpt-4-turbo`, and `end.api_id` is the id the last on-screen row showed.
- **Proof.** With the `gpt-4-turbo` chain on screen, run `browser_take_screenshot` with filename `$ART/lookup-chain.png` and `browser_snapshot` with filename `$ART/lookup-chain.aria.md`. Repeat for the miss state as `lookup-miss.png` and `lookup-miss.aria.md`. The saved snapshots hold the tree only (box value, chain rows or miss text); the page URL is in the tool response and the base URL in `run.env`, so name it in the report.

## Gotchas

- The empty box's placeholder types through the examples on a timer, so two screenshots of an empty box differ. Assert the combobox value and the listbox, never the placeholder text.
- Enter with an arrow-highlighted option picks that option instead of submitting what you typed. Press Escape first if the typed text is what you want looked up.
- The listbox closes on blur. Snapshot before clicking anywhere else; clicking an option does not blur (the list swallows mousedown).
- Chip text depends on today's date ("N days", "calls fail today", "retired Oct 28, 2025"). Assert that a chip is present, not its number.
- Endpoint ids may be typed without the leading slash; `v1/assistants` resolves the same as `/v1/assistants`.
- The `/` shortcut is ignored while any input, textarea, select, or contenteditable has focus.
- The first lookup after page load fetches `/api/registry` once; if that fails the page says "Could not load the registry. Try again." and the button reads "Loading..." until then. Doctor's registry check rules this out before you start.
- Pass `target` `#check` to `browser_snapshot`; without it the 199-row register below makes every snapshot thousands of lines. On `/` the hero has no id, so snapshot the whole page once and then use refs.
- The hero copy on `/` is the same component at a larger size; a proof on `/dead#check` does not cover the landing entry point by itself.
