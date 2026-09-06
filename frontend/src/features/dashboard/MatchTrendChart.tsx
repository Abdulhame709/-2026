import type { MatchTrendPoint } from '@/shared/types';

/**
 * رسم تطور نسبة المطابقة — SVG داخلي بسيط (بلا مكتبات رسوم خارجية — شرط التشغيل المحلي Q16).
 * اتجاه الزمن من اليمين (الأقدم) لليسار (الأحدث) — قراءة طبيعية RTL.
 */

interface MatchTrendChartProps {
  data: MatchTrendPoint[];
}

const WIDTH = 340;
const HEIGHT = 175;
const PAD_BOTTOM = 30;
const PAD_TOP = 24;
const BAR_WIDTH = 32;
const GAP = 12;
const MAX_RATE = 100;

export function MatchTrendChart({ data }: MatchTrendChartProps) {
  if (data.length === 0) return null;

  // RTL: نعكس الترتيب فيبدأ الأقدم من اليمين
  const ordered = [...data].reverse();
  const totalWidth = ordered.length * BAR_WIDTH + (ordered.length - 1) * GAP;
  const startX = (WIDTH - totalWidth) / 2;
  const chartHeight = HEIGHT - PAD_BOTTOM - PAD_TOP;
  const baselineY = HEIGHT - PAD_BOTTOM;

  const first = data[0];
  const last = data[data.length - 1];
  const ariaLabel = `تطور نسبة المطابقة الشهرية من ${first.month} (${first.rate}%) إلى ${last.month} (${last.rate}%)`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={ariaLabel}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <line
        x1={8}
        x2={WIDTH - 8}
        y1={baselineY}
        y2={baselineY}
        stroke="var(--color-border)"
        strokeWidth={1}
      />
      {ordered.map((point, index) => {
        const barHeight = (point.rate / MAX_RATE) * chartHeight;
        const x = startX + index * (BAR_WIDTH + GAP);
        const y = baselineY - barHeight;
        const isLatest = index === ordered.length - 1;
        return (
          <g key={point.month}>
            {/* خلفية تتبع خفيفة تساعد على قراءة الارتفاع النسبي */}
            <rect
              x={x}
              y={PAD_TOP}
              width={BAR_WIDTH}
              height={chartHeight}
              rx={4}
              fill="var(--color-bg-page)"
            />
            <rect
              x={x}
              y={y}
              width={BAR_WIDTH}
              height={barHeight}
              rx={4}
              fill={isLatest ? 'var(--color-primary)' : '#A7C4DC'}
            />
            <text
              x={x + BAR_WIDTH / 2}
              y={y - 7}
              textAnchor="middle"
              fontSize={11}
              fontWeight={isLatest ? 700 : 500}
              fill="var(--color-text-secondary)"
            >
              {point.rate}%
            </text>
            <text
              x={x + BAR_WIDTH / 2}
              y={HEIGHT - 9}
              textAnchor="middle"
              fontSize={11}
              fill="var(--color-text-secondary)"
            >
              {point.month}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
