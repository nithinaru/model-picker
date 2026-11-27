/** What the picker is set to. */
export type Choice = {
  /** A key of the mod's model rows, such as `opus-5-5`. */
  model: string
  /** A key of the mod's effort columns, such as `default` or `max`. */
  effort: string
  /** Whether the Ultracode toggle is on. */
  isUltra: boolean
  /** False until the person first picks a cell: the mod then changes nothing. */
  isOn: boolean
}

/** What the session itself last sent, so the dot starts where the session is. */
export type Seen = {
  model: string | null
  effort: string | null
}

/** How the grid is showing, and the proof of what the pick did. */
export type View = {
  /** Whether the older models are unfolded. */
  isExpanded: boolean
  /** The id of the model that answered the latest request; null before one. */
  ran: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'model-picker': { choice: Shaped<Choice>; seen: Shaped<Seen>; view: Shaped<View> }
  }
}
