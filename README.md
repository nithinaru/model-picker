# model-picker

A Claude mod that picks the model and effort level on a grid.

Click the button above the prompt (it shows "Pick model" or the current choice), or type `/model-picker`. Rows are models and columns are effort levels: drag the dot, click a cell, or use the arrow keys. Cells a model does not support are dimmed and the dot is pulled back to the last level the model allows. Older models stay folded behind "More models".

Until you pick a cell the mod changes nothing, and the dot sits on whatever the session is already using. After a pick, the line under the grid names the model that answered your last prompt.

## Ultracode

Ultracode is a toggle, independent of effort. When it's on, the mod adds the word `ultracode` to your prompt so Claude Code switches on multi-agent orchestration, on top of whatever effort level is set.

## Limits

- The mod API lists neither the available models nor their effort levels, so both are a hand-kept table at the top of `hooks/register.tsx`. Update it when the lineup changes.
- A mod can't replace the app's own `/model` command or model menu; this is a separate picker that sits beside it.
- The picker is drawn in the desktop app and the terminal. Other surfaces show the current choice as text.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
