import { Art, C, Ring, Txt, Wave } from "./_shared";

export default function UniversalHeader(){return <Art w={1048.8} h={590} label="Index 0.1 — a place for your spoken thoughts">
 <g fill="none" stroke={C.line} strokeWidth={1}>
 <path d="M-20 240H218q28 0 28-28v-48q0-28 28-28h126M-20 257H235q28 0 28-28v-48q0-28 28-28h109M648 200h80q24 0 24 24v48q0 24 24 24h292M648 217h63q24 0 24 24v48q0 24 24 24h309"/>
 <path d="M300 610V441q0-28 28-28h169v-67M317 610V458q0-28 28-28h169v-84M102 0v80q0 24 24 24h114M932 0v108q0 24-24 24H804"/>
 </g>
 <Wave x={-15} y={198} w={200} h={65}/>
 <g transform="translate(807 259)"><path d="M0 0H180V106H0Z" fill={C.card} stroke={C.line}/><path d="m18 28 5 5 9-11m-14 45 5 5 9-11" stroke={C.coral} strokeWidth={2} fill="none"/><path d="M48 28h102M48 67h76" stroke={C.line} strokeWidth={3}/></g>
 <Ring x={441} y={136} size={166}/>
 <Txt x={524.4} y={320} size={22} anchor="middle" weight={500}>Index <tspan fill={C.muted} fontSize={15}>0.1</tspan></Txt>
 <Txt x={69} y={493} size={12} cls="mono muted">CAPTURE → UNDERSTAND → ACT</Txt>
 <Txt x={979} y={493} size={12} cls="mono muted" anchor="end">A SYSTEM OF YOUR OWN.</Txt>
 </Art>;}
