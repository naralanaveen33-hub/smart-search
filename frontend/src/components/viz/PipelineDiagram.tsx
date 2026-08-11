import { motion } from 'framer-motion'
import { useReducedMotion } from '@/hooks/useAsync'

/**
 * Flat vector illustration: Documents -> Index -> Search.
 * Pure SVG, theme-aware through currentColor and CSS variables.
 */
export function PipelineDiagram() {
  const reduced = useReducedMotion()
  const draw = (delay: number) =>
    reduced
      ? { initial: false as const, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.35, delay, ease: 'easeOut' as const },
        }

  return (
    <svg
      viewBox="0 0 420 190"
      className="h-auto w-full"
      role="img"
      aria-label="Documents flow into an inverted index, which answers search queries"
    >
      <g stroke="var(--border-strong)" fill="none" strokeWidth="1">
        {/* Documents */}
        <motion.g {...draw(0.05)}>
          <rect x="16" y="46" width="58" height="76" rx="4" fill="var(--surface-2)" />
          <rect x="26" y="38" width="58" height="76" rx="4" fill="var(--surface-2)" />
          <rect x="36" y="30" width="58" height="76" rx="4" fill="var(--surface)" />
          <line x1="46" y1="46" x2="84" y2="46" />
          <line x1="46" y1="56" x2="84" y2="56" />
          <line x1="46" y1="66" x2="72" y2="66" />
          <line x1="46" y1="76" x2="84" y2="76" />
          <line x1="46" y1="86" x2="66" y2="86" />
        </motion.g>

        {/* Arrow 1 */}
        <motion.g {...draw(0.15)} stroke="var(--accent)">
          <line x1="104" y1="68" x2="146" y2="68" strokeWidth="1.25" />
          <path d="M141 63l6 5-6 5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </motion.g>

        {/* Inverted index */}
        <motion.g {...draw(0.25)}>
          <rect
            x="158"
            y="22"
            width="104"
            height="92"
            rx="5"
            fill="var(--surface)"
            stroke="var(--accent)"
          />
          <line x1="158" y1="42" x2="262" y2="42" stroke="var(--accent)" />
          <rect x="168" y="28" width="30" height="7" rx="1.5" fill="var(--accent)" stroke="none" />
          {[54, 68, 82, 96].map((y, i) => (
            <g key={y}>
              <rect
                x="168"
                y={y}
                width="26"
                height="7"
                rx="1.5"
                fill="var(--border-strong)"
                stroke="none"
              />
              <line x1="200" y1={y + 3.5} x2="212" y2={y + 3.5} />
              {[0, 1, 2].slice(0, 3 - (i % 2)).map((n) => (
                <rect
                  key={n}
                  x={216 + n * 13}
                  y={y + 0.5}
                  width="10"
                  height="6"
                  rx="1.5"
                  fill="var(--border-strong)"
                  stroke="none"
                />
              ))}
            </g>
          ))}
        </motion.g>

        {/* Arrow 2 */}
        <motion.g {...draw(0.35)} stroke="var(--accent)">
          <line x1="272" y1="68" x2="314" y2="68" strokeWidth="1.25" />
          <path d="M309 63l6 5-6 5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </motion.g>

        {/* Search */}
        <motion.g {...draw(0.45)}>
          <rect x="326" y="52" width="78" height="26" rx="4" fill="var(--surface)" />
          <circle cx="341" cy="65" r="5" stroke="var(--accent)" strokeWidth="1.5" />
          <line x1="345" y1="69" x2="349" y2="73" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="357" y1="65" x2="393" y2="65" />
          {[88, 100, 112].map((y, i) => (
            <rect
              key={y}
              x="326"
              y={y}
              width={78 - i * 14}
              height="7"
              rx="1.5"
              fill="var(--border-strong)"
              stroke="none"
            />
          ))}
        </motion.g>
      </g>

      <g fill="var(--text-muted)" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="0.08em">
        <text x="36" y="140">DOCUMENTS</text>
        <text x="171" y="140">INVERTED INDEX</text>
        <text x="341" y="140">SEARCH</text>
      </g>
    </svg>
  )
}
