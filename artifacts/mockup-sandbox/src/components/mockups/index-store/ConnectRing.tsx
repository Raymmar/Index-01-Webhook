import { Art, Arrow, Brand, C, Foot, Ring, Txt, Wave } from "./_shared";

export default function ConnectRing(){return <Art label="Your ring. Your endpoint. The official Pebble app forwards audio and transcript to your unique webhook.">
 <Brand n="03" topic="CONNECT"/>
 <Txt x={34} y={142} size={59} cls="serif">Your ring.</Txt><Txt x={34} y={203} size={59} cls="serif">Your endpoint.</Txt>
 <Txt x={36} y={246} size={16} cls="muted">From the official Pebble app</Txt><Txt x={36} y={270} size={16} cls="muted">to your own Index inbox.</Txt>
 <path d="M86 386v374" stroke={C.line} strokeWidth={1.5}/>
 <rect x={35} y={325} width={102} height={102} rx={5} fill={C.card} stroke={C.line}/><Ring x={51} y={341} size={70}/>
 <Txt x={158} y={358} size={11} cls="mono coral">01 / CAPTURE</Txt><Txt x={158} y={388} size={21} weight={500}>Pebble Index 01</Txt><Txt x={158} y={413} size={13} cls="muted">Hold the button. Say the thought.</Txt>
 <Txt x={105} y={462} size={10} cls="mono muted">BLUETOOTH</Txt><Arrow x={86} y={439} down/>
 <rect x={35} y={487} width={102} height={102} rx={5} fill={C.card} stroke={C.line}/>
 <g fill="none" stroke={C.ink} strokeWidth={1.7}><rect x={70} y={506} width={32} height={64} rx={5}/><path d="M80 513h12m-10 49h8"/></g>
 <Txt x={158} y={519} size={11} cls="mono coral">02 / FORWARD</Txt><Txt x={158} y={549} size={21} weight={500}>Official Pebble app</Txt><Txt x={158} y={574} size={13} cls="muted">Sends audio + transcript.</Txt>
 <Txt x={105} y={626} size={10} cls="mono coral">HTTP WEBHOOK</Txt><Arrow x={86} y={603} down/>
 <rect x={35} y={651} width={370} height={161} rx={4} fill={C.ink}/>
 <Txt x={55} y={683} size={10} cls="mono light">03 / RECEIVE IN INDEX 0.1</Txt>
 <path d="m57 714-8 8 8 8m17-16 8 8-8 8m-7-19-5 22" fill="none" stroke={C.coral} strokeWidth={2}/>
 <Txt x={96} y={728} size={19} cls="light" weight={500}>Your unique endpoint</Txt>
 <Wave x={57} y={758} w={125} h={23}/><path d="M210 758h167m-167 10h144m-144 10h157" stroke={C.muted} strokeWidth={2}/>
 <Foot n="03" label="RING → PEBBLE APP → YOUR INBOX"/>
 </Art>;}
