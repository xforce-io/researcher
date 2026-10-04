/** Enough English tokens to pass default 1000-char / 150-word HTML threshold. */
export function longProse(seed: string, words = 180): string {
  const filler = ' argument evidence tradeoff memory latency replay consistency';
  let out = seed.trim();
  while (out.split(/\s+/).filter(Boolean).length < words || out.length < 1100) {
    out += filler;
  }
  return out;
}

export function longParagraphs(seed: string, count = 4): string {
  return Array.from({ length: count }, (_, i) => `<p>${longProse(`${seed} paragraph ${i + 1}.`)}</p>`).join('\n');
}
