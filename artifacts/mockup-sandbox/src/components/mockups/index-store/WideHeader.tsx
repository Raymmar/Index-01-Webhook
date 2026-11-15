import { Art, C, Ring, Txt, Wave } from "./_shared";

export default function WideHeader(){return <Art w={960} h={411.5} label="Index 0.1 — voice into a system of your own">
 <g fill="none" stroke={C.line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
  <path d="M230 205H262.5Q278.5 205 278.5 189V186Q278.5 170 294.5 170H327"/>
  <path d="M482 249H700Q716 249 716 233V221Q716 205 732 205H750"/>
 </g>
 <rect x={40} y={155} width={190} height={100} rx={16} fill={C.card} stroke={C.line} strokeWidth={1.5}/>
 <Wave x={61} y={181} w={148} h={48}/>
 <Ring x={327} y={127} size={155}/>
 <Txt x={503} y={193} size={45} weight={500}>Index <tspan fontSize={20} fill={C.muted}>0.1</tspan></Txt>
 <Txt x={505} y={224} size={13} cls="muted">Your voice. Your system.</Txt>
 <rect x={750} y={155} width={170} height={100} rx={16} fill={C.card} stroke={C.line} strokeWidth={1.5}/>
 <g fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
  <rect x={770} y={177} width={20} height={20} rx={5} stroke={C.sage}/><rect x={770} y={215} width={20} height={20} rx={5} stroke={C.sage}/>
  <path d="m775 186 4 4 7-8m-11 42 4 4 7-8" stroke={C.sage}/><path d="M806 187h94M806 225h73" stroke={C.line}/>
 </g>
 <Txt x={41} y={367} size={10} cls="mono muted">PERSONAL VOICE → TASKS</Txt><Txt x={919} y={367} size={10} cls="mono muted" anchor="end">INDEX 0.1</Txt>
 </Art>;}
