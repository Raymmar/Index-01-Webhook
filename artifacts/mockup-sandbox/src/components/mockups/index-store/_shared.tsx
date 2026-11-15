import type { ReactNode } from "react";
import "./_group.css";

export const C={paper:"#f3f1ec",ink:"#1e2930",coral:"#e86b4b",card:"#faf8f5",line:"#dbd7cd",muted:"#636e74",sage:"#527a72"};
export function Art({children,w=440,h=956,label}:{children:ReactNode;w?:number;h?:number;label:string}){
  return <svg className="index-store-art" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}><title>{label}</title><rect width={w} height={h} fill={C.paper}/>{children}</svg>;
}
export function Ring({x,y,size}:{x:number;y:number;size:number}){return <image href="/__mockup/images/index-store-ring.svg" x={x} y={y} width={size} height={size}/>;}
export function Txt({x,y,size=14,children,cls="",weight=400,anchor="start"}:{x:number;y:number;size?:number;children:ReactNode;cls?:string;weight?:number;anchor?:"start"|"middle"|"end"}){return <text x={x} y={y} fontSize={size} fontWeight={weight} className={cls} textAnchor={anchor}>{children}</text>;}
export function Brand({n,topic}:{n:string;topic:string}){return <><Ring x={31} y={30} size={25}/><Txt x={65} y={49} size={18} weight={500}>Index <tspan fill={C.muted} fontSize={12}>0.1</tspan></Txt><Txt x={405} y={47} size={10} anchor="end" cls="mono">{n} / {topic}</Txt><path d="M35 72H405" stroke={C.line}/></>;}
export function Foot({n,label}:{n:string;label:string}){return <><path d="M35 858H405" stroke={C.line}/><Txt x={35} y={887} size={10} cls="mono">{label}</Txt><Txt x={405} y={887} size={10} cls="mono" anchor="end">{n}—04</Txt><Txt x={35} y={919} size={11} cls="muted">Independent companion for Pebble Index 01.</Txt></>;}
export function Wave({x,y,w=280,h=52,color=C.coral}:{x:number;y:number;w?:number;h?:number;color?:string}){
 const values=[.12,.21,.35,.19,.48,.78,.51,.31,.6,.92,.72,.43,.25,.46,.68,.36,.19,.41,.81,.98,.65,.39,.18,.36,.57,.3,.16,.46,.69,.42,.24,.11,.29,.43,.22,.12];
 return <g transform={`translate(${x} ${y})`}>{values.map((v,i)=><path key={i} d={`M${i*w/(values.length-1)} ${h*(1-v)/2}v${h*v}`} stroke={color} strokeWidth={2.7} strokeLinecap="round"/>)}</g>;
}
export function Arrow({x,y,down=false,color=C.coral}:{x:number;y:number;down?:boolean;color?:string}){return <path d={down?`M${x} ${y}v26m-5-5 5 5 5-5`:`M${x} ${y}h26m-5-5 5 5-5 5`} fill="none" stroke={color} strokeWidth={1.5}/>;}
export function Tick({x,y,color=C.sage}:{x:number;y:number;color?:string}){return <g><rect x={x} y={y} width={20} height={20} rx={4} stroke={color} fill="none"/><path d={`m${x+5} ${y+10} 4 4 7-8`} fill="none" stroke={color} strokeWidth={1.5}/></g>;}
