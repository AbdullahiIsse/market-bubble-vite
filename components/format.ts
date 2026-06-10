// Number formatting shared by the chat UI.
export function num(n: number): string {
  return n.toLocaleString('en-US');
}

// Renders a viewer count, or an em dash when the source is unavailable (null).
export function countOrDash(n: number | null): string {
  return n == null ? '—' : num(n);
}
