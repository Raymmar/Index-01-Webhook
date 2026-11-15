import { Art, C, Txt, Wave } from "./_shared";

/**
 * One continuous idea: capture → Index → tasks.
 * Both connector elbows and content panels use a 16-unit radius; every
 * connector terminates exactly at a node edge. No decorative loose ends.
 */
export default function UniversalHeader() {
  return (
    <Art w={1048.8} h={590} label="Index 0.1 — your voice, understood and organized">
      <g fill="none" stroke={C.line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M286 245H347.5Q363.5 245 363.5 229V227Q363.5 211 379.5 211H441.4" />
        <path d="M607.4 211H669.3Q685.3 211 685.3 227V229Q685.3 245 701.3 245H762.8" />
      </g>

      <rect x={60} y={193} width={226} height={104} rx={16} fill={C.card} stroke={C.line} strokeWidth={1.5} />
      <Wave x={84} y={219} w={178} h={52} />

      {/* Exact geometry and colors of the existing app logo, scaled from 64. */}
      <svg x={441.4} y={128} width={166} height={166} viewBox="0 0 64 64">
        <rect width={64} height={64} rx={16} fill="#1f2a30" />
        <circle cx={32} cy={32} r={17} fill="none" stroke="#e9e4da" strokeWidth={6} />
        <circle cx={32} cy={15} r={5} fill="#e8674a" />
      </svg>

      <rect x={762.8} y={193} width={226} height={104} rx={16} fill={C.card} stroke={C.line} strokeWidth={1.5} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
        <rect x={786.8} y={216} width={20} height={20} rx={5} stroke={C.sage} />
        <rect x={786.8} y={254} width={20} height={20} rx={5} stroke={C.sage} />
        <path d="m791.8 225 4 4 7-8m-11 42 4 4 7-8" stroke={C.sage} />
        <path d="M824.8 226H964.8M824.8 264H935.8" stroke={C.line} />
      </g>

      <Txt x={524.4} y={322} size={22} anchor="middle" weight={500}>
        Index <tspan fill={C.muted} fontSize={15}>0.1</tspan>
      </Txt>
      <Txt x={173} y={329} size={10} cls="mono muted" anchor="middle">CAPTURE</Txt>
      <Txt x={875.8} y={329} size={10} cls="mono muted" anchor="middle">ACT</Txt>
      <Txt x={69} y={493} size={12} cls="mono muted">CAPTURE → UNDERSTAND → ACT</Txt>
      <Txt x={979} y={493} size={12} cls="mono muted" anchor="end">A SYSTEM OF YOUR OWN.</Txt>
    </Art>
  );
}
