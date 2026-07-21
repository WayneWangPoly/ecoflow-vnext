export {};

declare global {
  interface HTMLSelectElement {
    /**
     * Optional defensive fallback used by the role-change guard. The actual
     * previous role is captured in data-operational-previous-value on focus.
     */
    readonly defaultValue?: string;
  }
}
