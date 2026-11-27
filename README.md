# model-picker

A Claude mod that picks the model and effort level from a button above the prompt.

Click the button (it shows "Pick model" or the current choice) to open the picker. Pick a model from the dropdown, pick an effort level from the row of buttons beneath it — only the levels that model supports are shown — and toggle Ultracode separately. The choice applies to every following request in the session and is remembered across sessions.

Until you pick a model the mod changes nothing, and the picker mirrors whatever model and effort the session is already using.

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
