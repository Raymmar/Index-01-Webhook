import { Art, Brand, C, Foot, Tick, Txt } from "./_shared";

export default function ActionTasks(){return <Art label="Say it. Sort it. Do it. AI finds tasks and dates while preserving the original note.">
 <Brand n="02" topic="UNDERSTAND"/>
 <Txt x={34} y={142} size={60} cls="serif">Say it. Sort it.</Txt><Txt x={34} y={203} size={60} cls="serif">Do it.</Txt>
 <Txt x={36} y={246} size={16} cls="muted">AI finds the tasks. Dates find their place.</Txt><Txt x={36} y={270} size={16} cls="muted">Your original note stays intact.</Txt>
 <path d="M220 486v12Q220 514 204 514H28Q12 514 12 530V677Q12 693 28 693H35M12 575Q12 591 28 591H35" fill="none" stroke={C.line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
 <rect x={35} y={324} width={370} height={162} rx={16} fill={C.ink}/>
 <Txt x={55} y={354} size={10} cls="mono light">ONE THOUGHT → TWO TASKS</Txt>
 <Txt x={55} y={393} size={24} cls="serif light">“Send Maya the sketches tomorrow.</Txt><Txt x={55} y={424} size={24} cls="serif light">Buy fixings on Friday. The shelf</Txt><Txt x={55} y={455} size={24} cls="serif light">could be a little lower, too.”</Txt>
 <rect x={35} y={547} width={370} height={88} rx={16} fill={C.card} stroke={C.line} strokeWidth={1.5}/><Tick x={54} y={568}/><Txt x={86} y={583} size={17} weight={500}>Send Maya the sketches</Txt><Txt x={86} y={612} size={11} cls="mono coral">TOMORROW</Txt>
 <rect x={35} y={649} width={370} height={88} rx={16} fill={C.card} stroke={C.line} strokeWidth={1.5}/><Tick x={54} y={670}/><Txt x={86} y={685} size={17} weight={500}>Buy fixings</Txt><Txt x={86} y={714} size={11} cls="mono coral">FRIDAY</Txt>
 <Txt x={220} y={785} size={13} cls="muted" anchor="middle">Shelf idea? Still in the original note.</Txt>
 <Txt x={35} y={824} size={11} cls="mono muted">TASKS + DUE DATES, IN YOUR TIMEZONE.</Txt>
 <Foot n="02" label="INBOX → UNDERSTAND → TASKS"/>
 </Art>;}
