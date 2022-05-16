export interface IApp<TState = any> {
  init: () => TState,
  draw?: (state: TState) => void,
  check?: (state: TState) => void
}