# model-picker

A Claude mod that picks the model and effort level on a grid.

Click the button above the prompt (it shows "Pick model" or the current choice), or type `/model-picker`. Rows are models and columns are effort levels: click a cell, drag the dot, or use the arrow keys. Clicking a model's name moves the dot to that model and keeps the level. Cells a model does not offer are dimmed, and the dot is pulled back to the last level the model allows. A drag that overshoots the grid lands on the nearest cell. Resting the pointer on Default or Ultracode says what that column does. Older models stay folded behind "More models".

Until you pick a cell the mod changes nothing: the dot is grey and sits on whatever the session is already using. A session model the table has no row for gets no dot, and the line under the grid names it. After a pick the dot takes its colour, every request goes out with the picked model and effort, and the line under the grid names the model that answered your last prompt.

The pick is kept across restarts. "Use session model", at the bottom right of the grid once a pick is made, hands the choice back to the session: the app's own model menu and `/model` are in charge again. From the keyboard, press down from the last row to reach the footer line, left and right to move along it, and Enter to press.

## Columns

- Default sends no effort level of the mod's own, so the session's setting stands.
- Low to Max send that effort level.
- Ultracode is the last column, next to Max. It sends Max effort and adds the word `ultracode` to each prompt you submit, which switches on Claude Code's multi-agent orchestration.

## Limits

- The mod API lists neither the available models nor their effort levels, so both are a hand-kept table at the top of `hooks/register.tsx`. Update it when the lineup changes.
- A mod can't replace the app's own `/model` command or model menu; this is a separate picker that sits beside it.
- The picker is drawn in the desktop app and the terminal. Other surfaces show the current choice as text.
- The grid has no surface of its own: it is drawn on the pane in the theme's own text colours, so it follows a light or dark theme. Violet for Ultracode is the one fixed colour, since no theme key is violet.
- The arrow keys reach the grid once it has the focus; if they do nothing, click in the pane first.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
./tools/preview.sh   # draws the grid's states to tools/out/preview.png
```
