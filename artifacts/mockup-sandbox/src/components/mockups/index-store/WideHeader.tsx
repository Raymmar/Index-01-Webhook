import { Art, C, Ring, Txt, Wave } from "./_shared";

export default function WideHeader(){return <Art w={960} h={411.5} label="Index 0.1 — voice into a system of your own">
 <g fill="none" stroke={C.line}><path d="M-20 199H213q25 0 25-25v-35q0-25 25-25h83M-20 216H230q25 0 25-25v-35q0-25 25-25h66M666 202h63q25 0 25 25v40q0 25 25 25h201M666 219h46q25 0 25 25v40q0 25 25 25h218M478 0v63M478 326v86"/></g>
 <Wave x={-15} y={154} w={185} h={70}/>
 <Ring x={327} y={127} size={155}/>
 <Txt x={503} y={193} size={45} weight={500}>Index <tspan fontSize={20} fill={C.muted}>0.1</tspan></Txt>
 <Txt x={505} y={224} size={13} cls="muted">Your voice. Your system.</Txt>
 <g stroke={C.line} fill={C.card}><path d="M818 255h164v97H818Z"/><path d="M837 279h102M837 301h79M837 323h91"/></g>
 <Txt x={41} y={367} size={10} cls="mono muted">PERSONAL VOICE → TASKS</Txt><Txt x={919} y={367} size={10} cls="mono muted" anchor="end">INDEX 0.1</Txt>
 </Art>;}
