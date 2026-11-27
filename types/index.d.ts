/** Where the dot sits, and what Auto last chose. */
export type Choice = {
  /** A key of the mod's model rows, such as `auto` or `opus-5-5`. */
  model: string
  /** A key of the mod's effort columns, such as `default` or `max`. */
  effort: string
  /** Whether the Ultracode toggle is on. */
  isUltra: boolean
  /** The model id Auto picked for the latest prompt; null before the first. */
  auto: string | null
  /** False until the person first moves the dot: the mod then changes nothing. */
  isOn: boolean
}

/** What the session itself last sent, so an untouched dot starts where the session is. */
export type Seen = {
  model: string | null
  effort: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'model-picker': { choice: Shaped<Choice>; seen: Shaped<Seen> }
  }
}
