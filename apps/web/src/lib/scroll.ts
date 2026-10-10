/** scrollTop that centres an element inside a scroll container, clamped to the valid range. */
export function centeredScrollTop(elTop: number, elHeight: number, clientHeight: number, scrollHeight: number): number {
  const target = elTop - clientHeight / 2 + elHeight / 2;
  return Math.min(Math.max(0, target), Math.max(0, scrollHeight - clientHeight));
}
