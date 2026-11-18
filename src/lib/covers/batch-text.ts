import { formatUsd } from "./cost";

export const booksWord = (n: number): string => (n === 1 ? "1 book" : `${n} books`);

/** "under $0.01" reads on its own; a dollar amount is an estimate. */
export function estimateText(micro: number): string {
  const usd = formatUsd(micro);
  return micro > 0 && !usd.startsWith("under") ? `about ${usd}` : usd;
}
