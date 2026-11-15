import { Art, Brand, C, Foot, Ring, Txt } from "./_shared";

export default function YourSetup(){return <Art label="A starting point for your workflow. Choose your AI provider and model, manage your webhook, and make the system yours.">
 <Brand n="04" topic="MAKE IT YOURS"/>
 <Txt x={34} y={140} size={56} cls="serif">A starting point</Txt><Txt x={34} y={198} size={56} cls="serif">for your workflow.</Txt>
 <Txt x={36} y={243} size={16} cls="muted">Choose the model. Control the connection.</Txt><Txt x={36} y={267} size={16} cls="muted">Build a personal system from here.</Txt>
 <rect x={65} y={355} width={310} height={90} fill={C.card} stroke={C.line} strokeWidth={1.5} rx={16}/><Txt x={85} y={382} size={10} cls="mono muted">THE INTELLIGENCE</Txt><Txt x={85} y={413} size={18} weight={500}>Your provider. Your model.</Txt><path d="M348 378v40m-7-26h14m-14 13h14" stroke={C.coral} strokeWidth={1.5} strokeLinecap="round"/>
 <path d="M220 445v41" stroke={C.line} strokeWidth={1.5}/>
 <rect x={97} y={486} width={246} height={155} rx={16} fill={C.ink}/><Ring x={181} y={504} size={78}/><Txt x={220} y={614} size={22} cls="light" anchor="middle" weight={500}>Index 0.1</Txt>
 <path d="M220 641v36" stroke={C.line} strokeWidth={1.5}/>
 <rect x={65} y={677} width={310} height={108} rx={16} fill={C.card} stroke={C.line} strokeWidth={1.5}/><Txt x={85} y={704} size={10} cls="mono muted">THE CONNECTION</Txt><Txt x={85} y={735} size={18} weight={500}>Webhook, under your control.</Txt><Txt x={85} y={762} size={12} cls="muted">Create · Copy · Rotate · Revoke</Txt>
 <Txt x={220} y={835} size={10} cls="mono muted" anchor="middle">MANAGED AI OR YOUR OWN SERVER-SIDE KEY.</Txt>
 <Foot n="04" label="PERSONAL BY DEFAULT. OPEN TO WHAT’S NEXT."/>
 </Art>;}
