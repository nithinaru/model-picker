# model-picker

A Claude mod that picks the model and effort level by dragging one dot across a grid.

Rows are models, columns are effort levels. Type `/model-picker` to open the pane, then drag the dot, or click it and use the arrow keys. The choice applies to every following request in the session and is remembered across sessions.

## The grid

- **Auto row**: the mod picks a model for each prompt (Haiku, Sonnet or Opus) by asking a small fast model how demanding the prompt is. This costs one extra small request per prompt.
- **Default column**: the mod sends no effort level of its own, so the session's setting stands.
- **Max**: the highest effort level.
- **Ultracode**: Max effort, plus the word `ultracode` added to the prompt so Claude Code switches on multi-agent orchestration.
- Cells a model does not support are dimmed, and the dot snaps back to the last level the model allows.

Until you move the dot for the first time the mod changes nothing.

## Limits

- The mod API lists neither the available models nor their effort levels, so both are a hand-kept table at the top of `hooks/register.tsx`. Update it when the lineup changes.
- The draggable grid is drawn in the desktop app and the terminal. Other surfaces show the current choice as text.
- The app's own model menu does not know about the mod's choice and may show a different model.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
