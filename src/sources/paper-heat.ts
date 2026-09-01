export type HeatSignals = {
  source?: string;
  upvotes?: number;
  github_stars?: number;
  published_date?: string;
};

export function calculateHeatIndex(paper: HeatSignals): number {
  let score = 0;

  const upvotes = paper.upvotes ?? 0;
  if (upvotes > 0) score += Math.min(60, Math.log(upvotes + 1) * 15);

  const stars = paper.github_stars ?? 0;
  if (stars > 0) score += Math.min(15, Math.log(stars + 1) * 3);

  score += freshnessScore(paper.published_date);

  if (paper.source === 'huggingface') score += 10;
  else if (paper.source === 'arxiv') score += 5;

  return Math.min(100, score);
}

export function calculateHeatLevel(heatIndex: number): number {
  if (heatIndex >= 80) return 5;
  if (heatIndex >= 60) return 4;
  if (heatIndex >= 40) return 3;
  if (heatIndex >= 20) return 2;
  return 1;
}

function freshnessScore(publishedDate: string | undefined): number {
  if (!publishedDate) return 25;
  const pub = parseYmd(publishedDate);
  if (!pub) return 15;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysOld = Math.floor((today.getTime() - pub.getTime()) / 86_400_000);
  if (daysOld <= 1) return 30;
  if (daysOld <= 3) return 25;
  if (daysOld <= 7) return 20;
  if (daysOld <= 14) return 10;
  return 5;
}

function parseYmd(s: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
