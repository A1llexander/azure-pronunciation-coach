# Pause hints ("Show pauses")

Status: experimental, branch `feat/pause-map`, not in `main`.

## What it does

The user presses **Show pauses** under the text box. The text box is replaced by the same text, unchanged, with the gaps between words styled. Nothing is inserted into the text: copying it gives back the original. **Edit text** returns to the text box. The user can record while the hints are shown and read from them.

| Look | Meaning | Rule |
|---|---|---|
| wide shaded gap | pause | after `.` `!` `?` `;` `:` `…` (not after `Mr.`, `e.g.` and similar) |
| narrow shaded gap | short pause if you like | after `,` or a dash; before a quotation, bracket or dash; before `because`, `which`, `when`… once the clause has 6+ words |
| underlined run of words | say together, no pause | after an article, preposition, possessive, auxiliary or modal, `to`, or the subject pronouns `I he she we they` (and contractions) |
| nothing | reader's choice | anything else |

Rules are checked in that order; the first match wins. Shape (gap width, underline) carries the meaning, color only reinforces it.

English only (`PAUSE_MAP_LOCALES`); the button is hidden for Spanish. Code: `src/pauseMap.js` (pure, tested in `tests/pauseMap.test.js`), `renderPauseMap` in `src/render.js`.

## Known limits

- **Not Azure's model.** Azure's prosody scorer decides `MissingBreak` / `UnexpectedBreak` with its own model, which it does not expose. These hints are an approximation.
- **No syntax.** A long subject before its verb with no comma (`The results of the experiment | surprised everyone`) gets no mark. This is the main gap of a rule-only approach.
- `that` is never treated as a subordinator (it is just as often a determiner).
- `do`, `have`, `be` used as main verbs still join to the next word (`can do for you` is one group).
- Hesitation pauses (before a word the reader is searching for) cannot be predicted from text.

## Before merging: check against Azure

Read 10–15 English texts with the hints shown and compare with Azure's prosody marks on the results:

1. `MissingBreak` should fall on wide or narrow gaps, not on unmarked ones.
2. `UnexpectedBreak` should rarely fall inside an underlined group, unless it was a real hesitation.

If many Azure marks contradict the hints, the feature teaches against the scorer in the same app; fix the rules or drop the feature before it reaches `main`.
