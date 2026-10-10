/** Classify errors so auth problems go to the "Reconnect Google" banner instead of toasts. */
export function isAuthError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { status?: number; message?: string; name?: string };
  if (err.status === 401) return true;
  if (err.status === 403 && /auth|credential|permission|scope/i.test(err.message ?? "")) return true;
  return /not signed in to google|sign-in failed|invalid authentication/i.test(err.message ?? "");
}
