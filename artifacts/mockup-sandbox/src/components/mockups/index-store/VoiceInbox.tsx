import { Art, Brand, C, Foot, Ring, Txt, Wave } from "./_shared";

export default function VoiceInbox(){return <Art label="Your voice. A place to land. Keep the original transcript and recording.">
 <Brand n="01" topic="CAPTURE"/>
 <Txt x={34} y={142} size={59} cls="serif">Your voice.</Txt><Txt x={34} y={203} size={59} cls="serif">A place to land.</Txt>
 <Txt x={36} y={246} size={16} cls="muted">The thought, the transcript, the recording.</Txt><Txt x={36} y={270} size={16} cls="muted">Together in your inbox.</Txt>
 <path d="M220 307v56" stroke={C.coral} strokeWidth={1.5}/><Ring x={197} y={300} size={46}/>
 <g transform="rotate(-3 220 545)"><rect x={47} y={379} width={350} height={328} rx={4} fill={C.line}/></g>
 <rect x={35} y={365} width={370} height={350} rx={4} fill={C.card} stroke={C.line}/>
 <path d="M35 413H405" stroke={C.line}/><rect x={35} y={365} width={4} height={48} fill={C.coral}/>
 <Txt x={57} y={395} size={10} cls="mono">ONE SPOKEN THOUGHT</Txt><Txt x={382} y={395} size={10} cls="mono muted" anchor="end">01</Txt>
 <Txt x={57} y={452} size={11} cls="mono muted">ORIGINAL TRANSCRIPT</Txt>
 <Txt x={55} y={493} size={27} cls="serif">“Send the sketches to Maya</Txt><Txt x={55} y={527} size={27} cls="serif">tomorrow. And maybe the</Txt><Txt x={55} y={561} size={27} cls="serif">shelf should be a little lower.”</Txt>
 <path d="M57 588H383" stroke={C.line}/>
 <Wave x={62} y={610} w={255} h={50}/><Txt x={381} y={643} size={11} cls="mono muted" anchor="end">0:12</Txt>
 <Txt x={57} y={690} size={10} cls="mono muted">ORIGINAL AUDIO, KEPT WITH THE NOTE</Txt>
 <path d="M220 715v49M213 757l7 7 7-7" fill="none" stroke={C.coral} strokeWidth={1.5}/>
 <Txt x={220} y={797} size={24} cls="serif" anchor="middle">Nothing lost in the sorting.</Txt>
 <Foot n="01" label="CAPTURE → INBOX"/>
 </Art>;}
