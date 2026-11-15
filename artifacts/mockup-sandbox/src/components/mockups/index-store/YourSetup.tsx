import { Art, Brand, C, Foot, Ring, Txt } from "./_shared";

export default function YourSetup(){return <Art label="A starting point for your workflow. Choose your AI provider and model, manage your webhook, and make the system yours.">
 <Brand n="04" topic="MAKE IT YOURS"/>
 <Txt x={34} y={140} size={56} cls="serif">A starting point</Txt><Txt x={34} y={198} size={56} cls="serif">for your workflow.</Txt>
 <Txt x={36} y={243} size={16} cls="muted">Choose the model. Control the connection.</Txt><Txt x={36} y={267} size={16} cls="muted">Build a personal system from here.</Txt>
 <path d="M47 332h346M47 809h346M47 332v477M393 332v477" fill="none" stroke={C.line} strokeDasharray="3 5"/>
 <path d="M35 332h24m-12-12v24M381 332h24m-12-12v24M35 809h24m-12-12v24M381 809h24m-12-12v24" stroke={C.muted} strokeWidth={1}/>
 <rect x={65} y={355} width={310} height={90} fill={C.card} stroke={C.line} rx={4}/><Txt x={85} y={382} size={10} cls="mono muted">THE INTELLIGENCE</Txt><Txt x={85} y={413} size={18} weight={500}>Your provider. Your model.</Txt><path d="M348 378v40m-7-26h14m-14 13h14" stroke={C.coral} strokeWidth={2}/>
 <path d="M220 445v52" stroke={C.coral} strokeWidth={1.5}/>
 <rect x={97} y={486} width={246} height={155} rx={4} fill={C.ink}/><rect x={178} y={501} width={84} height={84} rx={4} fill={C.paper}/><Ring x={181} y={504} size={78}/><Txt x={220} y={614} size={22} cls="light" anchor="middle" weight={500}>Index 0.1</Txt>
 <path d="M220 641v36" stroke={C.coral} strokeWidth={1.5}/>
 <rect x={65} y={677} width={310} height={108} rx={4} fill={C.card} stroke={C.line}/><Txt x={85} y={704} size={10} cls="mono muted">THE CONNECTION</Txt><Txt x={85} y={735} size={18} weight={500}>Webhook, under your control.</Txt><Txt x={85} y={762} size={12} cls="muted">Create · Copy · Rotate · Revoke</Txt>
 <Txt x={220} y={835} size={10} cls="mono muted" anchor="middle">MANAGED AI OR YOUR OWN SERVER-SIDE KEY.</Txt>
 <Foot n="04" label="PERSONAL BY DEFAULT. OPEN TO WHAT’S NEXT."/>
 </Art>;}
