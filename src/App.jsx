import { useState, useEffect, useCallback, useRef } from "react";
import { db } from "./firebase.js";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

const DAYS_ES   = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MONTHS_SH = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function parseLocal(iso){const[y,m,d]=iso.split("-").map(Number);return new Date(y,m-1,d);}
function isoDate(date){const d=typeof date==="string"?parseLocal(date):date;return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function isoToday(){const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function addDays(iso,n){const d=parseLocal(iso);d.setDate(d.getDate()+n);return isoDate(d);}
function formatDate(iso){if(!iso)return"";const d=parseLocal(iso);return`${String(d.getDate()).padStart(2,"0")}-${MONTHS_SH[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;}
function dow(iso){return parseLocal(iso).getDay();}
function nextValidDay(iso,weekDays){let c=iso;while(!weekDays.includes(dow(c)))c=addDays(c,1);return c;}
function defaultTimeOptions(iso){return dow(iso)===6?["07:00","08:00","09:00"]:["05:00","06:00","07:00"];}
function defaultTime(iso){return defaultTimeOptions(iso)[0];}
function fmt12(t){if(!t)return"";const[h,m]=t.split(":").map(Number);const ap=h<12?"AM":"PM";const hh=h===0?12:h>12?h-12:h;return`${hh}${m?":"+String(m).padStart(2,"0"):""}${ap}`;}
function doneCount(cls){return cls.filter(c=>c.status==="done").length;}
function cancelledCount(cls){return cls.filter(c=>c.status==="cancelled").length;}
function rescheduledCount(cls){return cls.filter(c=>c.status==="rescheduled").length;}
function buildSeqNums(cls,target){let n=0;return cls.map(c=>{if(c.status==="rescheduled")return null;n++;return n<=target?n:null;});}
function cycleName(cls){const co={};cls.forEach(c=>{const m=parseLocal(c.date).getMonth();co[m]=(co[m]||0)+1;});const d=Object.entries(co).sort((a,b)=>b[1]-a[1])[0];return d?MONTHS_ES[d[0]]:"Nuevo Ciclo";}

function generateClasses(startIso,config){
  const{classesPerCycle,weekDays}=config;const cls=[];let cursor=startIso;
  while(cls.length<classesPerCycle){
    if(weekDays.includes(dow(cursor)))cls.push({id:`cls-${Date.now()}-${cls.length}-${Math.random().toString(36).slice(2,5)}`,date:cursor,time:defaultTime(cursor),status:"pending",type:"presencial",notes:""});
    cursor=addDays(cursor,1);
  }
  return cls;
}

function buildCycle(startIso,config,idx){
  const cls=generateClasses(startIso,config);
  return{id:`cycle-${Date.now()}-${idx}`,name:cycleName(cls),classes:cls,paid:false,amount:config.amount,config:{...config},startDate:cls[0]?.date,endDate:cls[cls.length-1]?.date};
}

function recalcForward(classes,changedIdx,config){
  const updated=[...classes];let cursor=addDays(updated[changedIdx].date,1);
  for(let i=changedIdx+1;i<updated.length;i++){
    const s=updated[i].status;if(s==="done"||s==="cancelled"||s==="rescheduled")continue;
    while(!config.weekDays.includes(dow(cursor)))cursor=addDays(cursor,1);
    updated[i]={...updated[i],date:cursor,time:defaultTime(cursor)};cursor=addDays(cursor,1);
  }
  return updated;
}

function makeMakeup(classes,config){
  const lastDate=classes.reduce((mx,c)=>c.date>mx?c.date:mx,"1970-01-01");
  let cursor=addDays(lastDate,1);while(!config.weekDays.includes(dow(cursor)))cursor=addDays(cursor,1);
  return{id:`cls-${Date.now()}-mx-${Math.random().toString(36).slice(2,5)}`,date:cursor,time:defaultTime(cursor),status:"pending",type:"presencial",notes:"",isMakeup:true};
}

// Elimina clases pendientes sobrantes si hay mas de classesPerCycle slots activos
function sanitizeCycle(cycle){
  const target=cycle.config.classesPerCycle;
  let activeCount=cycle.classes.filter(c=>c.status!=="rescheduled").length;
  if(activeCount<=target)return cycle;
  // Eliminar pendientes sobrantes empezando por reposiciones del final
  const classes=[...cycle.classes];
  const result=[];
  for(let i=classes.length-1;i>=0;i--){
    if(activeCount>target&&classes[i].status==="pending"){
      activeCount--;
    } else {
      result.unshift(classes[i]);
    }
  }
  return{...cycle,classes:result,endDate:result[result.length-1]?.date};
}
function sanitizeCycles(data){return{...data,cycles:data.cycles.map(sanitizeCycle)};}

const DOC_REF=()=>doc(db,"gymtrack","main");
function cleanData(obj){
  if(Array.isArray(obj))return obj.map(cleanData);
  if(obj&&typeof obj==="object"){const r={};Object.entries(obj).forEach(([k,v])=>{if(v!==undefined)r[k]=cleanData(v);});return r;}
  return obj;
}
async function saveToFirebase(data){try{await setDoc(DOC_REF(),{payload:cleanData(data),updatedAt:new Date().toISOString()});}catch(e){console.error("Save error:",e);}}

function exportCSV(cycles,studentName,teacherName){
  const rows=[["Ciclo","Nombre","Estudiante","Profesor","#","Fecha","Hora","Estado","Modalidad","Notas","Pago","Monto"]];
  cycles.forEach((cy,ci)=>{const seqs=buildSeqNums(cy.classes,cy.config.classesPerCycle);cy.classes.forEach((c,i)=>rows.push([ci+1,cy.name,studentName,teacherName,seqs[i]??"↺",c.date,c.time,c.status,c.type,c.notes||"",cy.paid?"Pagado":"Pendiente",cy.amount]));});
  const csv=rows.map(r=>r.map(v=>`"${String(v)}"`).join(",")).join("\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`gymtrack_${studentName.replace(/\s+/g,"_")}.csv`;a.click();URL.revokeObjectURL(url);
}

const DEFAULT_CONFIG={classesPerCycle:12,weekDays:[2,4,6],amount:660000};
function initDefaultData(){
  const config={...DEFAULT_CONFIG};
  const s1=nextValidDay(isoToday(),config.weekDays);const c1=buildCycle(s1,config,0);
  const s2=nextValidDay(addDays(c1.endDate,1),config.weekDays);const c2=buildCycle(s2,config,1);
  const s3=nextValidDay(addDays(c2.endDate,1),config.weekDays);const c3=buildCycle(s3,config,2);
  return{teacherName:"Yony Vega",studentName:"Juan Sebastian",cycles:[c1,c2,c3],globalConfig:{...config}};
}

const C={
  bg:"#09090b",bg9:"#18181b",bg8:"#27272a",bg7:"#3f3f46",bg6:"#52525b",
  z1:"#f4f4f5",z2:"#e4e4e7",z3:"#d4d4d8",z4:"#a1a1aa",z5:"#71717a",z6:"#52525b",
  em:"#10b981",emBg:"rgba(5,150,105,0.15)",emBd:"rgba(16,185,129,0.3)",em2:"#34d399",
  rose:"#f43f5e",roseBg:"rgba(244,63,94,0.12)",roseBd:"rgba(244,63,94,0.25)",
  ora:"#f97316",oraBg:"rgba(249,115,22,0.12)",oraBd:"rgba(249,115,22,0.25)",
  sky:"#38bdf8",skyBg:"rgba(14,165,233,0.15)",skyBd:"rgba(56,189,248,0.35)",sky6:"#0284c7",
  amb:"#fbbf24",ambBg:"rgba(251,191,36,0.12)",ambBd:"rgba(251,191,36,0.3)",
  vio:"#a78bfa",vioBg:"rgba(139,92,246,0.15)",vioBd:"rgba(139,92,246,0.3)",
};

function Badge({label,color}){
  const m={green:{bg:C.emBg,bd:C.emBd,tx:C.em2},red:{bg:C.roseBg,bd:C.roseBd,tx:"#fb7185"},orange:{bg:C.oraBg,bd:C.oraBd,tx:"#fb923c"},yellow:{bg:C.ambBg,bd:C.ambBd,tx:C.amb},blue:{bg:C.skyBg,bd:C.skyBd,tx:C.sky},purple:{bg:C.vioBg,bd:C.vioBd,tx:C.vio},gray:{bg:"rgba(63,63,70,0.5)",bd:C.bg7,tx:C.z4}};
  const s=m[color]||m.gray;
  return<span style={{fontSize:"0.62rem",padding:"2px 7px",borderRadius:"999px",border:`1px solid ${s.bd}`,background:s.bg,color:s.tx,fontWeight:600,whiteSpace:"nowrap"}}>{label}</span>;
}

function TimeSelector({value,options,onChange}){
  const[editingIdx,setEditingIdx]=useState(null);
  function selectAgreed(t){onChange(t,options);}
  function editPill(idx,newTime){const o=[...options];o[idx]=newTime;onChange(options[idx]===value?newTime:value,o);}
  return(
    <div>
      <div style={{fontSize:"0.6rem",color:C.z5,marginBottom:"6px"}}>Toca para acordar · ✏️ para editar</div>
      <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
        {options.map((t,idx)=>{const isA=t===value;return(
          <div key={idx} style={{display:"flex",alignItems:"center",borderRadius:"10px",border:`1px solid ${isA?"rgba(16,185,129,0.5)":C.bg7}`,background:isA?"rgba(5,150,105,0.65)":C.bg8,transition:"all 0.15s"}}>
            {editingIdx===idx
              ?<input type="time" value={t} autoFocus onChange={e=>editPill(idx,e.target.value)} onBlur={()=>setEditingIdx(null)} style={{width:"88px",background:"transparent",border:"none",outline:"none",fontSize:"0.75rem",fontWeight:700,padding:"5px 8px",color:isA?"white":C.z2}}/>
              :<button onClick={()=>selectAgreed(t)} style={{fontSize:"0.75rem",fontWeight:700,padding:"5px 9px",background:"transparent",border:"none",cursor:"pointer",color:isA?"white":C.z4}}>
                {fmt12(t)}{isA&&<span style={{fontSize:"0.58rem",color:"rgba(209,250,229,0.6)",marginLeft:"3px",fontWeight:400}}>acordada</span>}
              </button>}
            <button onClick={()=>setEditingIdx(editingIdx===idx?null:idx)} style={{fontSize:"0.6rem",padding:"5px 5px",background:"transparent",border:"none",borderLeft:`1px solid ${isA?"rgba(16,185,129,0.3)":C.bg7}`,cursor:"pointer",color:isA?"rgba(209,250,229,0.5)":C.bg6}}>✏️</button>
          </div>
        );})}
      </div>
    </div>
  );
}

const CANCEL_REASONS=["Enfermedad estudiante","Enfermedad profesor","Día feriado","Vacaciones","Emergencia personal","Viaje","Clima","Otro motivo"];
const RESCHEDULE_REASONS=["Mutuo acuerdo","Conflicto de horario","Evento especial","Cambio de plan","Viaje","Otro motivo"];

function ReasonModal({title,subtitle,accentColor,reasons,onConfirm,onClose}){
  const[reason,setReason]=useState("");
  const ac=accentColor==="rose"?C.rose:C.ora;
  const acBg=accentColor==="rose"?C.roseBg:C.oraBg;
  const acBd=accentColor==="rose"?C.roseBd:C.oraBd;
  return(
    <div style={{position:"fixed",inset:0,zIndex:50,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
      <div style={{background:C.bg9,border:`1px solid ${acBd}`,borderRadius:"16px",padding:"20px",width:"100%",maxWidth:"380px"}}>
        <div style={{fontSize:"1rem",fontWeight:700,color:ac,marginBottom:"6px"}}>{title}</div>
        <p style={{fontSize:"0.7rem",color:C.z4,marginBottom:"12px",lineHeight:1.6}} dangerouslySetInnerHTML={{__html:subtitle}}/>
        <div style={{display:"flex",flexWrap:"wrap",gap:"5px",marginBottom:"10px"}}>
          {reasons.map(r=><button key={r} onClick={()=>setReason(r)} style={{fontSize:"0.68rem",padding:"4px 9px",borderRadius:"7px",cursor:"pointer",border:`1px solid ${reason===r?acBd:C.bg7}`,background:reason===r?acBg:C.bg8,color:reason===r?ac:C.z4}}>{r}</button>)}
        </div>
        <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="O escribe el motivo..." style={{width:"100%",background:C.bg8,border:`1px solid ${C.bg7}`,borderRadius:"9px",padding:"7px 11px",color:C.z2,fontSize:"0.875rem",outline:"none",marginBottom:"12px",boxSizing:"border-box"}}/>
        <div style={{display:"flex",gap:"8px"}}>
          <button onClick={()=>onConfirm(reason.trim()||"Sin motivo")} style={{flex:1,background:acBg,border:`1px solid ${acBd}`,color:ac,padding:"8px",borderRadius:"10px",fontSize:"0.875rem",cursor:"pointer",fontWeight:700}}>Confirmar</button>
          <button onClick={onClose} style={{flex:1,background:C.bg8,border:`1px solid ${C.bg7}`,color:C.z3,padding:"8px",borderRadius:"10px",fontSize:"0.875rem",cursor:"pointer"}}>Volver</button>
        </div>
      </div>
    </div>
  );
}

function ClassCard({cls,seqNum,onUpdate,onUpdateRecalc,onCancel,onReschedule,isPast}){
  const[editing,setEditing]=useState(false);
  const[showCancel,setShowCancel]=useState(false);
  const[showResched,setShowResched]=useState(false);
  const[localTime,setLocalTime]=useState(cls.time||defaultTime(cls.date));
  const[timeOpts,setTimeOpts]=useState(cls.timeOptions||defaultTimeOptions(cls.date));
  const[localDate,setLocalDate]=useState(cls.date);
  const[localType,setLocalType]=useState(cls.type||"presencial");
  const[localNotes,setLocalNotes]=useState(cls.notes||"");

  useEffect(()=>{
    setLocalTime(cls.time||defaultTime(cls.date));
    setTimeOpts(cls.timeOptions||defaultTimeOptions(cls.date));
    setLocalDate(cls.date);setLocalType(cls.type||"presencial");setLocalNotes(cls.notes||"");
  },[cls.id,cls.date,cls.time]);

  const isDone=cls.status==="done",isCanc=cls.status==="cancelled",isReschd=cls.status==="rescheduled",isPend=cls.status==="pending",isToday=isoToday()===cls.date;
  const dayName=DAYS_ES[parseLocal(cls.date).getDay()];

  function save(){
    const dc=localDate!==cls.date;
    const newOpts=dc?defaultTimeOptions(localDate):timeOpts;
    const newTime=dc?defaultTime(localDate):localTime;
    const upd={...cls,time:newTime,timeOptions:newOpts,notes:localNotes,type:localType,date:localDate};
    if(dc)onUpdateRecalc(upd);else onUpdate(upd);setEditing(false);
  }

  let cardBg,cardBd,numBg,numColor;
  if(isDone){cardBg="rgba(2,44,34,0.3)";cardBd=C.emBd;numBg=C.emBg;numColor=C.em2;}
  else if(isCanc){cardBg=C.roseBg;cardBd=C.roseBd;numBg="rgba(244,63,94,0.2)";numColor="#fb7185";}
  else if(isReschd){cardBg=C.oraBg;cardBd=C.oraBd;numBg="rgba(249,115,22,0.2)";numColor="#fb923c";}
  else if(isToday){cardBg=C.skyBg;cardBd=C.skyBd;numBg="rgba(14,165,233,0.2)";numColor=C.sky;}
  else{cardBg="rgba(39,39,42,0.45)";cardBd=C.bg7;numBg=C.bg7;numColor=C.z3;}

  const displayOpts=cls.timeOptions||defaultTimeOptions(cls.date);
  const agreedTime=cls.time||defaultTime(cls.date);
  const btn={fontSize:"0.68rem",padding:"4px 7px",borderRadius:"7px",cursor:"pointer",fontWeight:600,border:"none"};
  const inp={width:"100%",background:C.bg,border:`1px solid ${C.bg7}`,borderRadius:"7px",padding:"6px 8px",color:C.z2,fontSize:"0.875rem",outline:"none",boxSizing:"border-box"};

  return(
    <>
      <div style={{background:cardBg,border:`1px solid ${cardBd}`,borderRadius:"11px",opacity:(isPast&&!isDone&&!isCanc&&!isReschd)?0.55:1,transition:"all 0.2s"}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:"9px",padding:"11px"}}>
          <div style={{flexShrink:0,width:"30px",height:"30px",borderRadius:"7px",background:numBg,color:numColor,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.68rem",fontWeight:700}}>
            {isReschd?"↺":(seqNum??"-")}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:"4px",marginBottom:"3px"}}>
              <span style={{fontSize:"0.85rem",fontWeight:600,color:(isCanc||isReschd)?C.z6:C.z2}}>{dayName} {formatDate(cls.date)}</span>
              {isDone&&<Badge label="✓ Realizada" color="green"/>}
              {isCanc&&<Badge label="✗ Cancelada" color="red"/>}
              {isReschd&&<Badge label="↺ Reprogramada" color="orange"/>}
              {isToday&&!isDone&&!isCanc&&!isReschd&&<Badge label="● Hoy" color="blue"/>}
              {isPend&&!isToday&&<Badge label="Pendiente" color="gray"/>}
              {!isCanc&&!isReschd&&<Badge label={cls.type==="virtual"?"🖥 Virtual":"🏋 Presencial"} color={cls.type==="virtual"?"purple":"blue"}/>}
              {cls.isMakeup&&<Badge label="⚡ Reposición" color="yellow"/>}
            </div>
            {!isCanc&&!isReschd&&!editing&&(
              <div style={{display:"flex",gap:"4px",marginTop:"3px",flexWrap:"wrap"}}>
                {displayOpts.map((t,i)=>{const isA=t===agreedTime;return(
                  <span key={i} style={{padding:"1px 7px",borderRadius:"6px",fontSize:"0.65rem",fontWeight:700,background:isA?"rgba(5,150,105,0.6)":"rgba(39,39,42,0.6)",border:`1px solid ${isA?"rgba(16,185,129,0.4)":C.bg7}`,color:isA?"white":C.z5}}>
                    {fmt12(t)}{isA&&<span style={{fontSize:"0.55rem",color:"rgba(209,250,229,0.55)",marginLeft:"2px",fontWeight:400}}>acordada</span>}
                  </span>
                );})}
              </div>
            )}
            {cls.notes&&(isCanc||isReschd)&&<div style={{fontSize:"0.68rem",marginTop:"3px",color:isCanc?"#fb7185":"#fb923c"}}>{isCanc?"🚫":"↺"} {cls.notes}</div>}
            {cls.notes&&isPend&&<div style={{fontSize:"0.68rem",marginTop:"3px",color:C.z5}}>📝 {cls.notes}</div>}
          </div>
          <div style={{display:"flex",gap:"3px",flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
            {isPend&&<>
              <button onClick={()=>onUpdate({...cls,status:"done"})} style={{...btn,background:"rgba(5,150,105,0.7)",color:"white"}} title="Realizada">✓</button>
              <button onClick={()=>setShowCancel(true)} style={{...btn,background:C.roseBg,color:"#fb7185",border:`1px solid ${C.roseBd}`}} title="Cancelar">✗</button>
              <button onClick={()=>setShowResched(true)} style={{...btn,background:C.oraBg,color:"#fb923c",border:`1px solid ${C.oraBd}`}} title="Reprogramar">↺</button>
              <button onClick={()=>setEditing(!editing)} style={{...btn,background:C.bg7,color:C.z3}} title="Editar">✏️</button>
            </>}
            {isDone&&<button onClick={()=>onUpdate({...cls,status:"pending"})} style={{...btn,background:C.bg7,color:C.z3}} title="Deshacer">↩</button>}
            {(isCanc||isReschd)&&<button onClick={()=>onUpdate({...cls,status:"pending",notes:"",cancelledAt:null,rescheduledAt:null})} style={{...btn,background:C.bg7,color:C.z3}} title="Restaurar">↩</button>}
          </div>
        </div>
        {editing&&(
          <div style={{borderTop:`1px solid ${C.bg7}`,padding:"11px",display:"flex",flexDirection:"column",gap:"9px"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px"}}>
              <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"3px"}}>Fecha</label><input type="date" value={localDate} onChange={e=>setLocalDate(e.target.value)} style={inp}/></div>
              <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"3px"}}>Modalidad</label>
                <select value={localType} onChange={e=>setLocalType(e.target.value)} style={inp}><option value="presencial">🏋 Presencial</option><option value="virtual">🖥 Virtual</option></select>
              </div>
            </div>
            <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"5px"}}>Horas · acordada iluminada</label><TimeSelector value={localTime} options={timeOpts} onChange={(a,o)=>{setLocalTime(a);setTimeOpts(o);}}/></div>
            <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"3px"}}>Notas</label><input value={localNotes} onChange={e=>setLocalNotes(e.target.value)} placeholder="observaciones..." style={inp}/></div>
            <div style={{display:"flex",gap:"7px"}}>
              <button onClick={save} style={{flex:1,background:C.sky6,border:"none",color:"white",padding:"7px",borderRadius:"7px",fontSize:"0.875rem",cursor:"pointer",fontWeight:700}}>Guardar</button>
              <button onClick={()=>setEditing(false)} style={{flex:1,background:C.bg7,border:"none",color:C.z3,padding:"7px",borderRadius:"7px",fontSize:"0.875rem",cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
      {showCancel&&<ReasonModal title="Cancelar Clase" subtitle="La clase <strong style='color:#e4e4e7'>sí contabiliza</strong> como slot (sin reposición)." accentColor="rose" reasons={CANCEL_REASONS} onConfirm={r=>{onCancel({...cls,status:"cancelled",notes:r,cancelledAt:isoToday()});setShowCancel(false);}} onClose={()=>setShowCancel(false)}/>}
      {showResched&&<ReasonModal title="Reprogramar Clase" subtitle="Por mutuo acuerdo. <strong style='color:#e4e4e7'>NO cuenta</strong> como slot — se agrega reposición al final." accentColor="orange" reasons={RESCHEDULE_REASONS} onConfirm={r=>{onReschedule({...cls,status:"rescheduled",notes:r,rescheduledAt:isoToday()});setShowResched(false);}} onClose={()=>setShowResched(false)}/>}
    </>
  );
}

const DAY_OPT=[{v:1,l:"Lun"},{v:2,l:"Mar"},{v:3,l:"Mié"},{v:4,l:"Jue"},{v:5,l:"Vie"},{v:6,l:"Sáb"},{v:0,l:"Dom"}];

function CycleCard({cycle,cycleIndex,isCurrent,onUpdateCycle,onUpdateClass,onUpdateClassRecalc,onCancelClass,onRescheduleClass,onResetCycle,onDeleteCycle}){
  const target=cycle.config.classesPerCycle;
  const done=doneCount(cycle.classes),cancelled=cancelledCount(cycle.classes),reschd=rescheduledCount(cycle.classes);
  const remaining=Math.max(0,target-done-cancelled);
  const seqNums=buildSeqNums(cycle.classes,target);

  // Solo se puede reiniciar o eliminar si TODAS las clases están en pending
  const allPending=cycle.classes.every(c=>c.status==="pending");

  const[editingConfig,setEditingConfig]=useState(false);
  const[localConfig,setLocalConfig]=useState({...cycle.config});
  const[showAll,setShowAll]=useState(isCurrent);
  const[confirmReset,setConfirmReset]=useState(false);
  const[confirmDelete,setConfirmDelete]=useState(false);

  function saveConfig(){onUpdateCycle({...cycle,config:{...localConfig}});setEditingConfig(false);}

  const cardBd=isCurrent?"rgba(14,165,233,0.4)":C.bg7;
  const headerBg=isCurrent?"linear-gradient(to right,rgba(8,47,73,0.6),rgba(24,24,27,0.6))":"rgba(39,39,42,0.4)";
  const inp={background:C.bg,border:`1px solid ${C.bg7}`,borderRadius:"7px",padding:"6px 8px",color:C.z2,fontSize:"0.875rem",outline:"none",width:"100%",boxSizing:"border-box"};
  const btnSm={fontSize:"0.66rem",padding:"4px 7px",borderRadius:"7px",cursor:"pointer",border:"none",background:C.bg7,color:C.z3};
  const btnDisabled={opacity:0.35,cursor:"not-allowed"};

  return(
    <div style={{borderRadius:"14px",border:`1px solid ${cardBd}`,overflow:"hidden",background:"rgba(24,24,27,0.6)",boxShadow:isCurrent?"0 0 30px rgba(14,165,233,0.07)":"none"}}>
      <div style={{padding:"14px",background:headerBg}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"10px"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"7px",marginBottom:"3px"}}>
              {isCurrent?<span style={{fontSize:"0.62rem",padding:"2px 7px",borderRadius:"999px",background:C.sky6,color:"white",fontWeight:700}}>ACTUAL</span>:<span style={{fontSize:"0.62rem",padding:"2px 7px",borderRadius:"999px",background:C.bg7,color:C.z4}}>Ciclo {cycleIndex+1}</span>}
              <span style={{fontSize:"1.05rem",fontWeight:700,color:"white"}}>{cycle.name}</span>
            </div>
            <div style={{fontSize:"0.68rem",color:C.z4}}>{formatDate(cycle.startDate)} → {formatDate(cycle.endDate)}</div>
          </div>
          <button onClick={()=>onUpdateCycle({...cycle,paid:!cycle.paid})} style={{flexShrink:0,padding:"5px 11px",borderRadius:"9px",fontSize:"0.78rem",fontWeight:700,cursor:"pointer",border:"none",background:cycle.paid?"rgba(5,150,105,0.65)":C.bg8,color:cycle.paid?"white":C.z3}}>
            {cycle.paid?"💳 Pagado":"💰 Sin Pagar"}
          </button>
        </div>

        <div style={{marginTop:"10px"}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.7rem",marginBottom:"5px"}}>
            <span>
              <span style={{color:C.em,fontWeight:700}}>{done} realizadas</span>
              {cancelled>0&&<span style={{color:C.rose,marginLeft:"7px"}}>{cancelled} canceladas</span>}
              {reschd>0&&<span style={{color:C.ora,marginLeft:"7px"}}>{reschd} reprog.</span>}
            </span>
            <span style={{color:remaining>0?C.amb:C.em,fontWeight:700}}>{remaining>0?`${remaining} pendientes`:"✓ Completado"}</span>
          </div>
          <div style={{height:"7px",background:C.bg8,borderRadius:"999px",overflow:"hidden"}}>
            <div style={{height:"100%",display:"flex"}}>
              <div style={{background:C.em,width:`${Math.round((done/target)*100)}%`,transition:"width 0.5s"}}/>
              <div style={{background:"rgba(244,63,94,0.55)",width:`${Math.round((cancelled/target)*100)}%`,transition:"width 0.5s"}}/>
            </div>
          </div>
          <div style={{display:"flex",gap:"2px",marginTop:"5px"}}>
            {Array.from({length:target}).map((_,i)=>(
              <div key={i} style={{height:"4px",flex:1,borderRadius:"999px",background:i<done?C.em:i<done+cancelled?"rgba(244,63,94,0.5)":C.bg7,transition:"background 0.3s"}}/>
            ))}
          </div>
        </div>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:"8px"}}>
          <span style={{fontSize:"0.65rem",color:C.z5}}>${cycle.amount?.toLocaleString("es-CO")} COP · {target} clases{reschd>0&&<span style={{color:C.ora,marginLeft:"3px"}}>· +{reschd} repos.</span>}</span>
          <div style={{display:"flex",gap:"5px"}}>
            {/* Eliminar — solo si todas pendientes */}
            <button
              onClick={()=>allPending&&setConfirmDelete(true)}
              style={{...btnSm,background:allPending?C.roseBg:"rgba(63,63,70,0.2)",color:allPending?"#fb7185":C.z6,border:`1px solid ${allPending?C.roseBd:C.bg7}`,...(!allPending&&btnDisabled)}}
              title={allPending?"Eliminar ciclo":"No se puede eliminar: hay clases registradas"}>
              🗑️ Eliminar
            </button>
            {/* Reiniciar — solo si todas pendientes */}
            <button
              onClick={()=>allPending&&setConfirmReset(true)}
              style={{...btnSm,background:allPending?C.ambBg:"rgba(63,63,70,0.2)",color:allPending?C.amb:C.z6,border:`1px solid ${allPending?C.ambBd:C.bg7}`,...(!allPending&&btnDisabled)}}
              title={allPending?"Reiniciar ciclo":"No se puede reiniciar: hay clases registradas"}>
              🔄 Reiniciar
            </button>
            <button onClick={()=>setEditingConfig(!editingConfig)} style={btnSm}>⚙️ Config</button>
            <button onClick={()=>setShowAll(!showAll)} style={btnSm}>{showAll?"▲ Menos":"▼ Ver clases"}</button>
          </div>
        </div>
      </div>

      {/* Modal confirmar reiniciar */}
      {confirmReset&&(
        <div style={{position:"fixed",inset:0,zIndex:50,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
          <div style={{background:C.bg9,border:`1px solid ${C.ambBd}`,borderRadius:"14px",padding:"18px",width:"100%",maxWidth:"370px"}}>
            <div style={{fontSize:"0.95rem",fontWeight:700,color:C.amb,marginBottom:"7px"}}>🔄 Reiniciar Ciclo {cycleIndex+1}: {cycle.name}</div>
            <p style={{fontSize:"0.7rem",color:C.z4,marginBottom:"14px",lineHeight:1.6}}>
              Se regenerarán todas las clases de este ciclo con fechas correctas a partir de la última clase del ciclo anterior.<br/><br/>
              <strong style={{color:"#fb7185"}}>Todas las clases actuales serán reemplazadas.</strong>
            </p>
            <div style={{display:"flex",gap:"7px"}}>
              <button onClick={()=>{onResetCycle();setConfirmReset(false);}} style={{flex:1,background:C.ambBg,border:`1px solid ${C.ambBd}`,color:C.amb,padding:"7px",borderRadius:"9px",fontSize:"0.875rem",cursor:"pointer",fontWeight:700}}>Sí, reiniciar</button>
              <button onClick={()=>setConfirmReset(false)} style={{flex:1,background:C.bg8,border:`1px solid ${C.bg7}`,color:C.z3,padding:"7px",borderRadius:"9px",fontSize:"0.875rem",cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar eliminar */}
      {confirmDelete&&(
        <div style={{position:"fixed",inset:0,zIndex:50,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
          <div style={{background:C.bg9,border:`1px solid ${C.roseBd}`,borderRadius:"14px",padding:"18px",width:"100%",maxWidth:"370px"}}>
            <div style={{fontSize:"0.95rem",fontWeight:700,color:"#fb7185",marginBottom:"7px"}}>🗑️ Eliminar Ciclo {cycleIndex+1}: {cycle.name}</div>
            <p style={{fontSize:"0.7rem",color:C.z4,marginBottom:"14px",lineHeight:1.6}}>
              Esta acción <strong style={{color:"#fb7185"}}>elimina permanentemente</strong> este ciclo y todas sus clases.<br/><br/>
              Esta acción no se puede deshacer.
            </p>
            <div style={{display:"flex",gap:"7px"}}>
              <button onClick={()=>{onDeleteCycle();setConfirmDelete(false);}} style={{flex:1,background:C.roseBg,border:`1px solid ${C.roseBd}`,color:"#fb7185",padding:"7px",borderRadius:"9px",fontSize:"0.875rem",cursor:"pointer",fontWeight:700}}>Sí, eliminar</button>
              <button onClick={()=>setConfirmDelete(false)} style={{flex:1,background:C.bg8,border:`1px solid ${C.bg7}`,color:C.z3,padding:"7px",borderRadius:"9px",fontSize:"0.875rem",cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Config panel */}
      {editingConfig&&(
        <div style={{borderTop:`1px solid ${C.bg7}`,padding:"14px",background:"rgba(39,39,42,0.4)"}}>
          <div style={{fontSize:"0.85rem",fontWeight:600,color:C.z3,marginBottom:"10px"}}>Configuración del Ciclo</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"9px",marginBottom:"9px"}}>
            <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"3px"}}>Clases por ciclo</label><input type="number" min="1" max="30" value={localConfig.classesPerCycle} onChange={e=>setLocalConfig({...localConfig,classesPerCycle:+e.target.value})} style={inp}/></div>
            <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"3px"}}>Monto (COP)</label><input type="number" value={localConfig.amount} onChange={e=>setLocalConfig({...localConfig,amount:+e.target.value})} style={inp}/></div>
            <div style={{gridColumn:"1/-1"}}>
              <label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"4px"}}>Días</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:"5px"}}>
                {DAY_OPT.map(d=><button key={d.v} onClick={()=>{const days=localConfig.weekDays.includes(d.v)?localConfig.weekDays.filter(x=>x!==d.v):[...localConfig.weekDays,d.v].sort();setLocalConfig({...localConfig,weekDays:days});}} style={{fontSize:"0.7rem",padding:"3px 9px",borderRadius:"7px",cursor:"pointer",border:"none",background:localConfig.weekDays.includes(d.v)?C.sky6:C.bg8,color:localConfig.weekDays.includes(d.v)?"white":C.z4}}>{d.l}</button>)}
              </div>
            </div>
          </div>
          <div style={{display:"flex",gap:"7px"}}>
            <button onClick={saveConfig} style={{flex:1,background:C.sky6,border:"none",color:"white",padding:"6px",borderRadius:"7px",fontSize:"0.875rem",cursor:"pointer",fontWeight:700}}>Aplicar</button>
            <button onClick={()=>setEditingConfig(false)} style={{flex:1,background:C.bg7,border:"none",color:C.z3,padding:"6px",borderRadius:"7px",fontSize:"0.875rem",cursor:"pointer"}}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista de clases */}
      {showAll&&(
        <div style={{borderTop:`1px solid ${C.bg7}`,padding:"14px",display:"flex",flexDirection:"column",gap:"7px"}}>
          <div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",fontSize:"0.6rem",color:C.z5,paddingBottom:"7px",borderBottom:`1px solid ${C.bg8}`}}>
            <span>🟢 Realizada → cuenta slot</span>
            <span>🔴 Cancelada → cuenta slot</span>
            <span>🟠 Reprogramada → NO cuenta + reposición ⚡</span>
          </div>
          {cycle.classes.map((cls,i)=>(
            <ClassCard key={cls.id} cls={cls} seqNum={seqNums[i]} isPast={cls.date<isoToday()}
              onUpdate={upd=>onUpdateClass(cycleIndex,i,upd)}
              onUpdateRecalc={upd=>onUpdateClassRecalc(cycleIndex,i,upd)}
              onCancel={c=>onCancelClass(cycleIndex,i,c)}
              onReschedule={r=>onRescheduleClass(cycleIndex,i,r)}/>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App(){
  const[data,setData]=useState(null);
  const[loading,setLoading]=useState(true);
  const[saving,setSaving]=useState(false);
  const[lastSaved,setLastSaved]=useState(null);
  const[editNames,setEditNames]=useState(false);
  const[lStudent,setLStudent]=useState("");
  const[lTeacher,setLTeacher]=useState("");
  const[tab,setTab]=useState("cycles");
  const isFirstLoad=useRef(true);

  useEffect(()=>{
    const unsub=onSnapshot(DOC_REF(),snap=>{
      if(snap.exists()){setData(sanitizeCycles(snap.data().payload));setLastSaved(snap.data().updatedAt);}
      else if(isFirstLoad.current){const init=initDefaultData();setData(init);saveToFirebase(init);}
      setLoading(false);isFirstLoad.current=false;
    },err=>{console.error("Snapshot error:",err);setData(d=>d||initDefaultData());setLoading(false);});
    return()=>unsub();
  },[]);

  const persist=useCallback((nd)=>{
    const clean=sanitizeCycles(nd);
    setData(clean);setSaving(true);
    saveToFirebase(clean).then(()=>{setSaving(false);setLastSaved(new Date().toISOString());});
  },[]);

  function updateCycle(idx,upd){const c=[...data.cycles];c[idx]=upd;persist({...data,cycles:c});}
  function updateClass(ci,li,upd){const cycles=[...data.cycles];const cls=[...cycles[ci].classes];cls[li]=upd;cycles[ci]={...cycles[ci],classes:cls};persist({...data,cycles});}
  function updateClassRecalc(ci,li,upd){const cycles=[...data.cycles];let cls=[...cycles[ci].classes];cls[li]=upd;cls=recalcForward(cls,li,cycles[ci].config);cycles[ci]={...cycles[ci],classes:cls,endDate:cls[cls.length-1]?.date,name:cycleName(cls)};persist({...data,cycles});}
  function cancelClass(ci,li,cancelled){const cycles=[...data.cycles];const cls=[...cycles[ci].classes];cls[li]=cancelled;cycles[ci]={...cycles[ci],classes:cls};persist({...data,cycles});}

  function rescheduleClass(ci,li,reschd){
    const cycles=[...data.cycles];const cycle=cycles[ci];let cls=[...cycle.classes];
    // Contar slots activos ANTES de marcar como reprogramada
    const activeSlotsBefore=cls.filter(c=>c.status!=="rescheduled").length;
    cls[li]=reschd;
    // Solo agregar reposicion si habia exactamente el target de slots activos
    // (es decir, esta reprogramacion deja un hueco que hay que reponer)
    // y no hay ya una reposicion pendiente sin usar
    const pendingMakeups=cls.filter(c=>c.status==="pending"&&c.isMakeup).length;
    if(activeSlotsBefore<=cycle.config.classesPerCycle&&pendingMakeups===0){
      cls.push(makeMakeup(cls,cycle.config));
    }
    cycles[ci]={...cycle,classes:cls,endDate:cls[cls.length-1].date,name:cycleName(cls)};
    persist({...data,cycles});
  }

  function resetCycle(cycleIdx){
    const cycles=[...data.cycles];
    const cycle=cycles[cycleIdx];
    const config=cycle.config;
    // Arrancar desde el día siguiente válido después de la última clase del ciclo anterior
    const prevCycle=cycles[cycleIdx-1];
    const prevLastDate=prevCycle
      ?prevCycle.classes.reduce((mx,c)=>c.date>mx?c.date:mx,"1970-01-01")
      :isoToday();
    const freshStart=nextValidDay(addDays(prevLastDate,1),config.weekDays);
    const newClasses=[];let cursor=freshStart;
    while(newClasses.length<config.classesPerCycle){
      if(config.weekDays.includes(dow(cursor)))newClasses.push({
        id:`cls-${Date.now()}-${newClasses.length}-${Math.random().toString(36).slice(2,5)}`,
        date:cursor,time:defaultTime(cursor),status:"pending",type:"presencial",notes:""
      });
      cursor=addDays(cursor,1);
    }
    cycles[cycleIdx]={...cycle,classes:newClasses,startDate:newClasses[0].date,endDate:newClasses[newClasses.length-1].date,name:cycleName(newClasses)};
    persist({...data,cycles});
  }

  function deleteCycle(idx){
    const cycles=data.cycles.filter((_,i)=>i!==idx);
    persist({...data,cycles});
  }

  function addNextCycle(){
    const last=data.cycles[data.cycles.length-1];if(!last)return;
    const config=last.config||DEFAULT_CONFIG;
    // Usar la fecha real de la última clase (no endDate que puede estar desactualizado)
    const lastClassDate=last.classes.reduce((mx,c)=>c.date>mx?c.date:mx,"1970-01-01");
    const nextStart=nextValidDay(addDays(lastClassDate,1),config.weekDays);
    persist({...data,cycles:[...data.cycles,buildCycle(nextStart,config,Date.now())]});
  }

  if(loading)return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,sans-serif"}}>
      <div style={{textAlign:"center"}}><div style={{color:C.z4,fontSize:"0.875rem",marginBottom:"5px"}}>Conectando con Firebase...</div><div style={{color:C.z6,fontSize:"0.72rem"}}>GymTrack · Yony × Juan</div></div>
    </div>
  );

  const currentIdx=data.cycles.findIndex(c=>(doneCount(c.classes)+cancelledCount(c.classes))<c.config.classesPerCycle);
  const displayIdx=currentIdx===-1?data.cycles.length-1:currentIdx;
  const curCycle=data.cycles[displayIdx];
  const totalDone=data.cycles.reduce((s,c)=>s+doneCount(c.classes),0);
  const totalTarget=data.cycles.reduce((s,c)=>s+c.config.classesPerCycle,0);
  const remaining=curCycle?Math.max(0,curCycle.config.classesPerCycle-doneCount(curCycle.classes)-cancelledCount(curCycle.classes)):0;
  const btnA={fontSize:"0.7rem",padding:"5px 9px",borderRadius:"7px",cursor:"pointer",border:"none",background:C.bg8,color:C.z4};

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.z1,fontFamily:"'DM Sans',system-ui,sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box}`}</style>
      <div style={{position:"sticky",top:0,zIndex:40,background:"rgba(9,9,11,0.93)",backdropFilter:"blur(10px)",borderBottom:`1px solid ${C.bg8}`}}>
        <div style={{maxWidth:"680px",margin:"0 auto",padding:"9px 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:"9px"}}>
            <div style={{width:"32px",height:"32px",borderRadius:"9px",background:"linear-gradient(135deg,#0ea5e9,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.85rem",fontWeight:700}}>G</div>
            <div><div style={{fontSize:"0.85rem",fontWeight:700,lineHeight:1}}>GymTrack</div><div style={{fontSize:"0.65rem",color:C.z5,lineHeight:1,marginTop:"2px"}}>{data.teacherName} × {data.studentName}</div></div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
            {saving?<span style={{fontSize:"0.62rem",color:C.sky,marginRight:"3px"}}>💾 Guardando...</span>:lastSaved&&<span style={{fontSize:"0.62rem",color:C.z6,marginRight:"3px"}}>✓ Guardado</span>}
            <button onClick={()=>{setLStudent(data.studentName);setLTeacher(data.teacherName);setEditNames(true);}} style={btnA}>✏️ Nombres</button>
            <button onClick={()=>exportCSV(data.cycles,data.studentName,data.teacherName)} style={btnA}>⬇️ Excel</button>
          </div>
        </div>
      </div>

      <div style={{maxWidth:"680px",margin:"0 auto",padding:"18px 14px",display:"flex",flexDirection:"column",gap:"14px"}}>
        {editNames&&(
          <div style={{position:"fixed",inset:0,zIndex:50,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
            <div style={{background:C.bg9,border:`1px solid ${C.bg7}`,borderRadius:"14px",padding:"18px",width:"100%",maxWidth:"350px"}}>
              <div style={{fontSize:"0.95rem",fontWeight:700,marginBottom:"14px"}}>Editar Nombres</div>
              {[["Profesor",lTeacher,setLTeacher],["Estudiante",lStudent,setLStudent]].map(([label,val,set])=>(
                <div key={label} style={{marginBottom:"10px"}}>
                  <label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"3px"}}>{label}</label>
                  <input value={val} onChange={e=>set(e.target.value)} style={{width:"100%",background:C.bg8,border:`1px solid ${C.bg7}`,borderRadius:"9px",padding:"7px 11px",color:C.z2,fontSize:"0.875rem",outline:"none",boxSizing:"border-box"}}/>
                </div>
              ))}
              <div style={{display:"flex",gap:"7px",marginTop:"4px"}}>
                <button onClick={()=>{persist({...data,studentName:lStudent,teacherName:lTeacher});setEditNames(false);}} style={{flex:1,background:C.sky6,border:"none",color:"white",padding:"7px",borderRadius:"9px",fontSize:"0.875rem",cursor:"pointer",fontWeight:700}}>Guardar</button>
                <button onClick={()=>setEditNames(false)} style={{flex:1,background:C.bg7,border:"none",color:C.z3,padding:"7px",borderRadius:"9px",fontSize:"0.875rem",cursor:"pointer"}}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"7px"}}>
          {[
            {label:"Realizadas",value:totalDone,sub:`de ${totalTarget}`,color:C.em},
            {label:"Pendientes",value:remaining,sub:"ciclo actual",color:C.amb},
            {label:"Ciclos",value:data.cycles.length,sub:"programados",color:C.sky},
            {label:curCycle?.name||"-",value:curCycle?.paid?"✓":"$",sub:curCycle?.paid?"Pagado":"Sin pagar",color:curCycle?.paid?C.em:C.rose},
          ].map((s,i)=>(
            <div key={i} style={{background:"rgba(24,24,27,0.7)",border:`1px solid ${C.bg7}`,borderRadius:"11px",padding:"11px",textAlign:"center"}}>
              <div style={{fontSize:"1.35rem",fontWeight:800,color:s.color,lineHeight:1}}>{s.value}</div>
              <div style={{fontSize:"0.62rem",color:C.z5,marginTop:"3px"}}>{s.label}</div>
              <div style={{fontSize:"0.58rem",color:C.z6,marginTop:"2px"}}>{s.sub}</div>
            </div>
          ))}
        </div>

        <div style={{display:"flex",gap:"3px",background:C.bg9,borderRadius:"11px",padding:"3px"}}>
          {[{id:"cycles",label:"📅 Ciclos"},{id:"history",label:"📊 Historial"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:"7px",borderRadius:"8px",fontSize:"0.85rem",fontWeight:600,cursor:"pointer",border:"none",transition:"all 0.15s",background:tab===t.id?C.bg7:"transparent",color:tab===t.id?C.z1:C.z5}}>{t.label}</button>
          ))}
        </div>

        {tab==="cycles"&&(
          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
            {data.cycles.map((cycle,idx)=>(
              <CycleCard key={cycle.id} cycle={cycle} cycleIndex={idx} isCurrent={idx===displayIdx}
                onUpdateCycle={upd=>updateCycle(idx,upd)} onUpdateClass={updateClass}
                onUpdateClassRecalc={updateClassRecalc} onCancelClass={cancelClass}
                onRescheduleClass={rescheduleClass} onResetCycle={()=>resetCycle(idx)}
                onDeleteCycle={()=>deleteCycle(idx)}/>
            ))}
            <button onClick={addNextCycle} style={{padding:"11px",borderRadius:"14px",border:`2px dashed ${C.bg7}`,background:"transparent",color:C.z5,fontSize:"0.85rem",cursor:"pointer"}}>+ Agregar ciclo siguiente</button>
          </div>
        )}

        {tab==="history"&&(
          <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            <div style={{fontSize:"0.85rem",fontWeight:600,color:C.z4}}>Historial completo</div>
            {data.cycles.map((cycle,ci)=>{
              const d=doneCount(cycle.classes),ca=cancelledCount(cycle.classes),rs=rescheduledCount(cycle.classes),vi=cycle.classes.filter(c=>c.type==="virtual"&&c.status==="done").length;
              return(
                <div key={cycle.id} style={{background:"rgba(24,24,27,0.7)",border:`1px solid ${C.bg7}`,borderRadius:"11px",padding:"14px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"9px"}}>
                    <span style={{fontWeight:600,color:C.z2}}>Ciclo {ci+1}: {cycle.name}</span>
                    <Badge label={cycle.paid?"Pagado":"Pendiente"} color={cycle.paid?"green":"yellow"}/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"5px",textAlign:"center"}}>
                    {[{v:d,l:"Realizadas",c:C.em},{v:ca,l:"Canceladas",c:C.rose},{v:rs,l:"Reprog.",c:C.ora},{v:vi,l:"Virtuales",c:C.vio},{v:`$${(cycle.amount||0).toLocaleString("es-CO")}`,l:"COP",c:C.sky}].map((s,i)=>(
                      <div key={i} style={{background:C.bg8,borderRadius:"7px",padding:"7px"}}>
                        <div style={{fontSize:i===4?"0.6rem":"0.95rem",fontWeight:700,color:s.c}}>{s.v}</div>
                        <div style={{fontSize:"0.58rem",color:C.z5,marginTop:"2px"}}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{marginTop:"7px",fontSize:"0.62rem",color:C.z6}}>{formatDate(cycle.startDate)} → {formatDate(cycle.endDate)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
