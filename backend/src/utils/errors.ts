export function isRateLimitError(err: unknown): boolean {
  const named = (err as { name?: string })?.name;
  if (named === "ParallelRateLimitError") return true;
  const message = String((err as { message?: string })?.message || err || "");
  return /429|rate limit|too many requests/i.test(message);
}
