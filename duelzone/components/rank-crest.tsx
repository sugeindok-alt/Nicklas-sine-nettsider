import { RANKS, rankFor } from "@/lib/shared";
export function RankCrest({
  rating,
  size = 52,
}: {
  rating: number;
  size?: number;
}) {
  const rank = rankFor(rating),
    tier = RANKS.findIndex((r) => r.name === rank.name);
  const tones = [
    "#c9a27f",
    "#bac8d6",
    "#dfc484",
    "#a4c8ba",
    "#a0c9df",
    "#c3b7d8",
    "#d5ed9a",
  ];
  return (
    <svg
      className="rank-crest"
      viewBox="0 0 64 76"
      width={size}
      height={(size * 76) / 64}
      fill="none"
      aria-label={`${rank.name} rank`}
      role="img"
      style={{ color: tones[tier] }}
    >
      <path
        d="M6 9L32 2L58 9V47L32 73L6 47V9Z"
        fill="currentColor"
        fillOpacity=".06"
        stroke="currentColor"
        strokeOpacity=".55"
      />
      <path
        d="M13 15L32 10L51 15V44L32 63L13 44V15Z"
        stroke="currentColor"
        strokeOpacity=".25"
      />
      <path
        d="M19 29L32 41L45 29M19 38L32 50L45 38"
        stroke="currentColor"
        strokeWidth="4"
      />
      {tier > 1 && (
        <path d="M22 18L32 25L42 18" stroke="currentColor" strokeWidth="3" />
      )}
      {tier > 3 && (
        <path
          d="M2 22V44L10 52M62 22V44L54 52"
          stroke="currentColor"
          strokeWidth="2"
        />
      )}
      <path d="M29 19L32 16L35 19L32 22Z" fill="currentColor" />
    </svg>
  );
}
