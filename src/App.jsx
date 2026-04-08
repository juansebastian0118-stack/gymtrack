import { useState, useEffect, useRef } from "react";
import { db } from "./firebase.js";
import { doc, onSnapshot, setDoc, collection, addDoc, getDoc } from "firebase/firestore";
import {
  getAuth, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, sendPasswordResetEmail
} from "firebase/auth";

const auth = getAuth();

// ─── DATE HELPERS ─────────────────────────────────────────────────────────
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
function defaultTimeOptions(iso,config){const d=dow(iso);if(config?.dayTimeOptions?.[d])return config.dayTimeOptions[d];return d===6?["07:00","08:00","09:00"]:["05:00","06:00","07:00"];}
function defaultTime(iso,config){return defaultTimeOptions(iso,config)[0];}
function fmt12(t){if(!t)return"";const[h,m]=t.split(":").map(Number);const ap=h<12?"AM":"PM";const hh=h===0?12:h>12?h-12:h;return`${hh}${m?":"+String(m).padStart(2,"0"):""}${ap}`;}
function doneCount(cls){return cls.filter(c=>c.status==="done").length;}
function cancelledCount(cls){return cls.filter(c=>c.status==="cancelled").length;}
function rescheduledCount(cls){return cls.filter(c=>c.status==="rescheduled").length;}
function buildSeqNums(cls,target){let n=0;return cls.map(c=>{if(c.status==="rescheduled")return null;n++;return n<=target?n:null;});}
function cycleName(cls){const co={};cls.forEach(c=>{const m=parseLocal(c.date).getMonth();co[m]=(co[m]||0)+1;});const d=Object.entries(co).sort((a,b)=>b[1]-a[1])[0];return d?MONTHS_ES[d[0]]:"Nuevo Ciclo";}
function slugify(name){return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}

function generateClasses(startIso,config){
  const{classesPerCycle,weekDays}=config;const cls=[];let cursor=startIso;
  while(cls.length<classesPerCycle){
    if(weekDays.includes(dow(cursor))){
      const opts=defaultTimeOptions(cursor,config);
      cls.push({id:`cls-${Date.now()}-${cls.length}-${Math.random().toString(36).slice(2,5)}`,date:cursor,time:opts[0],timeOptions:opts,status:"pending",type:"presencial",notes:""});
    }
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
    const opts=defaultTimeOptions(cursor,config);
    updated[i]={...updated[i],date:cursor,time:opts[0],timeOptions:opts};cursor=addDays(cursor,1);
  }
  return updated;
}
function makeMakeup(classes,config){
  const lastDate=classes.reduce((mx,c)=>c.date>mx?c.date:mx,"1970-01-01");
  let cursor=addDays(lastDate,1);while(!config.weekDays.includes(dow(cursor)))cursor=addDays(cursor,1);
  const opts=defaultTimeOptions(cursor,config);
  return{id:`cls-${Date.now()}-mx-${Math.random().toString(36).slice(2,5)}`,date:cursor,time:opts[0],timeOptions:opts,status:"pending",type:"presencial",notes:"",isMakeup:true};
}
function sanitizeCycle(cycle){
  const target=cycle.config.classesPerCycle;
  const activeCount=cycle.classes.filter(c=>c.status!=="rescheduled").length;
  if(activeCount<=target)return cycle;
  const excess=activeCount-target;
  const classes=[...cycle.classes];let removed=0;
  for(let i=classes.length-1;i>=0&&removed<excess;i--){if(classes[i].status==="pending"&&classes[i].isMakeup){removed++;classes[i]=null;}}
  for(let i=classes.length-1;i>=0&&removed<excess;i--){if(classes[i]&&classes[i].status==="pending"){removed++;classes[i]=null;}}
  const cleaned=classes.filter(c=>c!==null);
  return{...cycle,classes:cleaned,endDate:cleaned[cleaned.length-1]?.date};
}
function sanitizeCycles(data){return{...data,cycles:data.cycles.map(sanitizeCycle)};}

// ─── FIREBASE ─────────────────────────────────────────────────────────────
const SYSTEM_REF=()=>doc(db,"gymtrack-system","config");
const STUDENT_REF=(uid)=>doc(db,"gymtrack-data",uid);
const AUDIT_COL=()=>collection(db,"gymtrack-audit");

function cleanData(obj){
  if(Array.isArray(obj))return obj.map(cleanData);
  if(obj&&typeof obj==="object"){const r={};Object.entries(obj).forEach(([k,v])=>{if(v!==undefined)r[k]=cleanData(v);});return r;}
  return obj;
}
async function writeAudit(user,action,detail=""){
  try{await addDoc(AUDIT_COL(),{uid:user.uid,email:user.email,role:user.role,action,detail,at:new Date().toISOString()});}
  catch(e){console.error("Audit error:",e);}
}
async function saveStudentData(uid,data,user){
  try{await setDoc(STUDENT_REF(uid),{payload:cleanData(data),updatedAt:new Date().toISOString(),updatedBy:{uid:user.uid,email:user.email,role:user.role}});}
  catch(e){console.error("Save error:",e);}
}
async function saveSystemConfig(cfg,user){
  try{await setDoc(SYSTEM_REF(),{payload:cleanData(cfg),updatedAt:new Date().toISOString(),updatedBy:{uid:user.uid,email:user.email,role:user.role}});}
  catch(e){console.error("System save error:",e);}
}

// ─── CHANGE 3: export students CSV ────────────────────────────────────────
async function exportStudentsCSV(systemConfig) {
  const rows = [["Nombre","Teléfono","Email","Clases último ciclo"]];
  for (const s of systemConfig.students||[]) {
    let lastCycleClasses = s.config?.classesPerCycle || 12;
    // Try to get last cycle classes from student data
    try {
      const snap = await getDoc(STUDENT_REF(s.id));
      if (snap.exists()) {
        const payload = snap.data().payload || snap.data();
        const cycles = payload.cycles || [];
        if (cycles.length > 0) {
          lastCycleClasses = cycles[cycles.length-1].config?.classesPerCycle || lastCycleClasses;
        }
      }
    } catch {}
    rows.push([s.name||"", s.phone||"", s.email||"", lastCycleClasses]);
  }
  const csv = rows.map(r=>r.map(v=>`"${String(v)}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download="alumnos_gymtrack.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ─── ROLES ────────────────────────────────────────────────────────────────
const ROLES={
  admin:   {label:"Administrador",color:"#7c3aed"},
  profesor:{label:"Profesor",      color:"#0284c7"},
  alumno:  {label:"Alumno",        color:"#10b981"},
};
const DEFAULT_CONFIG={classesPerCycle:12,weekDays:[2,4,6],amount:660000};
const DEFAULT_SYSTEM={teacherName:"Yony Vega",students:[]};
function canManage(role){return role==="admin"||role==="profesor";}

function initStudentData(student){
  const config=student.config||DEFAULT_CONFIG;
  const s1=nextValidDay(isoToday(),config.weekDays);const c1=buildCycle(s1,config,0);
  const s2=nextValidDay(addDays(c1.endDate,1),config.weekDays);const c2=buildCycle(s2,config,1);
  return{teacherName:"",studentName:student.name,cycles:[c1,c2],globalConfig:{...config}};
}

// ─── COLORS ───────────────────────────────────────────────────────────────
const C={
  bg:"#09090b",bg9:"#18181b",bg8:"#27272a",bg7:"#3f3f46",bg6:"#52525b",
  z1:"#f4f4f5",z2:"#e4e4e7",z3:"#d4d4d8",z4:"#a1a1aa",z5:"#71717a",z6:"#52525b",
  em:"#10b981",emBg:"rgba(5,150,105,0.15)",emBd:"rgba(16,185,129,0.3)",em2:"#34d399",
  rose:"#f43f5e",roseBg:"rgba(244,63,94,0.12)",roseBd:"rgba(244,63,94,0.25)",
  ora:"#f97316",oraBg:"rgba(249,115,22,0.12)",oraBd:"rgba(249,115,22,0.25)",
  sky:"#38bdf8",skyBg:"rgba(14,165,233,0.15)",skyBd:"rgba(56,189,248,0.35)",sky6:"#0284c7",
  amb:"#fbbf24",ambBg:"rgba(251,191,36,0.12)",ambBd:"rgba(251,191,36,0.3)",
  vio:"#a78bfa",vioBg:"rgba(139,92,246,0.15)",vioBd:"rgba(139,92,246,0.3)",
  // CHANGE 4: gray tone for logo
  logoGray:"rgba(120,120,130,0.75)",
};

function Badge({label,color}){
  const m={green:{bg:C.emBg,bd:C.emBd,tx:C.em2},red:{bg:C.roseBg,bd:C.roseBd,tx:"#fb7185"},orange:{bg:C.oraBg,bd:C.oraBd,tx:"#fb923c"},yellow:{bg:C.ambBg,bd:C.ambBd,tx:C.amb},blue:{bg:C.skyBg,bd:C.skyBd,tx:C.sky},purple:{bg:C.vioBg,bd:C.vioBd,tx:C.vio},gray:{bg:"rgba(63,63,70,0.5)",bd:C.bg7,tx:C.z4}};
  const s=m[color]||m.gray;
  return<span style={{fontSize:"0.62rem",padding:"2px 7px",borderRadius:"999px",border:`1px solid ${s.bd}`,background:s.bg,color:s.tx,fontWeight:600,whiteSpace:"nowrap"}}>{label}</span>;
}

// ─── SHARED: DayTimeEditor ────────────────────────────────────────────────
const DAY_NAMES_SHORT={0:"Dom",1:"Lun",2:"Mar",3:"Mié",4:"Jue",5:"Vie",6:"Sáb"};
function buildDefaultDayTimeOptions(weekDays){const r={};weekDays.forEach(d=>{r[d]=d===6?["07:00","08:00","09:00"]:["05:00","06:00","07:00"];});return r;}

function DayTimeEditor({config,setConfig}){
  const[editingTimesFor,setEditingTimesFor]=useState(null);
  const DAY_OPT=[{v:2,l:"Mar"},{v:4,l:"Jue"},{v:6,l:"Sáb"},{v:1,l:"Lun"},{v:3,l:"Mié"},{v:5,l:"Vie"},{v:0,l:"Dom"}];
  function toggleDay(d){
    const days=config.weekDays.includes(d)?config.weekDays.filter(x=>x!==d):[...config.weekDays,d].sort();
    const dto={...(config.dayTimeOptions||{})};
    if(!days.includes(d))delete dto[d];else if(!dto[d])dto[d]=d===6?["07:00","08:00","09:00"]:["05:00","06:00","07:00"];
    setConfig({...config,weekDays:days,dayTimeOptions:dto});
    if(editingTimesFor===d)setEditingTimesFor(null);
  }
  function updateDayTime(d,idx,val){
    const dto={...(config.dayTimeOptions||{}),[d]:[...(config.dayTimeOptions?.[d]||[])]};
    dto[d][idx]=val;setConfig({...config,dayTimeOptions:dto});
  }
  return(
    <div>
      <label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"6px"}}>Días de clase · toca 🕐 para editar horarios</label>
      <div style={{display:"flex",flexWrap:"wrap",gap:"5px",marginBottom:"10px"}}>
        {DAY_OPT.map(d=>{const active=config.weekDays.includes(d.v);const editing=editingTimesFor===d.v;return(
          <div key={d.v} style={{display:"flex",alignItems:"center",borderRadius:"8px",border:`1px solid ${active?(editing?C.sky:C.sky6):C.bg7}`,overflow:"hidden"}}>
            <button onClick={()=>toggleDay(d.v)} style={{fontSize:"0.7rem",padding:"4px 9px",cursor:"pointer",border:"none",background:active?(editing?C.skyBg:"rgba(2,132,199,0.25)"):"transparent",color:active?"white":C.z5,fontWeight:active?700:400}}>{d.l}</button>
            {active&&<button onClick={()=>setEditingTimesFor(editing?null:d.v)} style={{fontSize:"0.65rem",padding:"4px 6px",cursor:"pointer",border:"none",borderLeft:`1px solid ${editing?C.skyBd:C.bg7}`,background:editing?C.skyBg:C.bg8,color:editing?C.sky:C.z4}}>🕐</button>}
          </div>
        );})}
      </div>
      {editingTimesFor!==null&&config.dayTimeOptions?.[editingTimesFor]&&(
        <div style={{background:C.skyBg,border:`1px solid ${C.skyBd}`,borderRadius:"10px",padding:"12px",marginBottom:"10px"}}>
          <div style={{fontSize:"0.72rem",fontWeight:700,color:C.sky,marginBottom:"6px"}}>Horarios — {DAY_NAMES_SHORT[editingTimesFor]}</div>
          <div style={{fontSize:"0.62rem",color:C.z4,marginBottom:"8px"}}>El 1.º es la hora acordada por defecto</div>
          <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
            {config.dayTimeOptions[editingTimesFor].map((t,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:"8px"}}>
                <span style={{fontSize:"0.65rem",color:i===0?C.em2:C.z5,fontWeight:i===0?700:400,minWidth:"54px"}}>{i===0?"1.ª (acord.)":i===1?"2.ª opción":"3.ª opción"}</span>
                <input type="time" value={t} onChange={e=>updateDayTime(editingTimesFor,i,e.target.value)} style={{flex:1,background:C.bg,border:`1px solid ${i===0?C.emBd:C.bg7}`,borderRadius:"7px",padding:"5px 8px",color:i===0?C.em2:C.z2,fontSize:"0.82rem",outline:"none"}}/>
                <span style={{fontSize:"0.65rem",color:C.z5,minWidth:"40px"}}>{fmt12(t)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CHANGE 4: Logo component (gray + 💪) ─────────────────────────────────
function GymLogo({size="md"}){
  const big = size==="lg";
  return(
    <div style={{display:"inline-flex",flexDirection:"column",alignItems:"center",padding:big?"7px 16px":"4px 8px",borderRadius:big?"12px":"8px",background:"rgba(100,100,110,0.18)",border:"1px solid rgba(120,120,130,0.35)",backdropFilter:"blur(4px)"}}>
      <div style={{fontSize:big?"1.1rem":"0.65rem",fontWeight:800,color:"#b0b0be",letterSpacing:"0.3px",lineHeight:1}}>💪 Gymtrack</div>
      <div style={{fontSize:big?"0.65rem":"0.45rem",fontWeight:600,color:"rgba(160,160,175,0.75)",letterSpacing:"0.5px",lineHeight:1,marginTop:"2px"}}>Yony Vega</div>
    </div>
  );
}

// ─── GYM IMAGES ───────────────────────────────────────────────────────────
const GYM_IMAGES=[
  "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=900&q=80",
  "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=900&q=80",
  "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=900&q=80",
  "https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=900&q=80",
];

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────
function LoginScreen({onLogin}){
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[error,setError]=useState("");
  const[loading,setLoading]=useState(false);
  const[resetSent,setResetSent]=useState(false);
  const[imgIdx,setImgIdx]=useState(0);
  useEffect(()=>{const t=setInterval(()=>setImgIdx(i=>(i+1)%GYM_IMAGES.length),4000);return()=>clearInterval(t);},[]);

  async function handleLogin(e){
    e.preventDefault();setError("");setLoading(true);
    try{
      const cred=await signInWithEmailAndPassword(auth,email.trim(),password);
      const token=await cred.user.getIdTokenResult();
      const role=token.claims.role;
      if(!role){setError("Tu cuenta no tiene un rol asignado. Contacta al administrador.");setLoading(false);return;}
      onLogin({uid:cred.user.uid,email:cred.user.email,role});
    }catch(err){
      if(err.code==="auth/invalid-credential"||err.code==="auth/wrong-password"||err.code==="auth/user-not-found")setError("Email o contraseña incorrectos.");
      else if(err.code==="auth/too-many-requests")setError("Demasiados intentos. Espera unos minutos.");
      else setError("Error al iniciar sesión. Intenta de nuevo.");
      setLoading(false);
    }
  }
  async function handleReset(){
    if(!email.trim()){setError("Ingresa tu email primero.");return;}
    try{await sendPasswordResetEmail(auth,email.trim());setResetSent(true);setError("");}
    catch{setError("No se pudo enviar el correo. Verifica el email.");}
  }
  const inp={width:"100%",background:C.bg8,border:`1px solid ${C.bg7}`,borderRadius:"10px",padding:"11px 14px",color:C.z1,fontSize:"0.9rem",outline:"none",boxSizing:"border-box",marginBottom:"10px"};
  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'DM Sans',system-ui,sans-serif",display:"flex",flexDirection:"column"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap');*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}body{margin:0;padding:0;background:#09090b;}input,button{font-family:inherit;-webkit-appearance:none;appearance:none;}`}</style>
      {/* Hero */}
      <div style={{position:"relative",height:"240px",overflow:"hidden",flexShrink:0}}>
        {GYM_IMAGES.map((src,i)=>(
          <img key={i} src={src} alt="gym" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",objectPosition:"center",opacity:i===imgIdx?1:0,transition:"opacity 1.2s ease",filter:"brightness(0.45)"}}/>
        ))}
        <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom,rgba(9,9,11,0.1) 0%,rgba(9,9,11,0.85) 100%)"}}/>
        <div style={{position:"absolute",bottom:"20px",left:0,right:0,textAlign:"center"}}>
          {/* CHANGE 4: gray logo with 💪 */}
          <div style={{marginBottom:"8px"}}><GymLogo size="lg"/></div>
          <div style={{fontSize:"1.3rem",fontWeight:800,color:"white"}}>by Juappnerí</div>
          <div style={{fontSize:"0.72rem",color:"rgba(255,255,255,0.5)",marginTop:"3px"}}>Juappnerí productor de aplicaciones Web</div>
        </div>
        <div style={{position:"absolute",top:"12px",right:"14px",display:"flex",gap:"5px"}}>
          {GYM_IMAGES.map((_,i)=><div key={i} onClick={()=>setImgIdx(i)} style={{width:"6px",height:"6px",borderRadius:"50%",background:i===imgIdx?"white":"rgba(255,255,255,0.3)",cursor:"pointer",transition:"background 0.3s"}}/>)}
        </div>
      </div>
      {/* Form */}
      <div style={{flex:1,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"28px 20px 60px"}}>
        <div style={{width:"100%",maxWidth:"360px"}}>
          {resetSent?(
            <div style={{textAlign:"center",padding:"20px",background:C.emBg,border:`1px solid ${C.emBd}`,borderRadius:"12px"}}>
              <div style={{fontSize:"1.5rem",marginBottom:"8px"}}>📧</div>
              <div style={{fontSize:"0.9rem",fontWeight:700,color:C.em2,marginBottom:"6px"}}>Correo enviado</div>
              <div style={{fontSize:"0.75rem",color:C.z4,marginBottom:"14px"}}>Revisa tu bandeja de entrada para restablecer tu contraseña.</div>
              <button onClick={()=>setResetSent(false)} style={{background:C.emBg,border:`1px solid ${C.emBd}`,color:C.em2,padding:"8px 20px",borderRadius:"8px",cursor:"pointer",fontSize:"0.85rem",fontWeight:600}}>Volver al login</button>
            </div>
          ):(
            <form onSubmit={handleLogin}>
              <div style={{fontSize:"0.82rem",color:C.z4,textAlign:"center",marginBottom:"18px"}}>Inicia sesión con tu cuenta</div>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Correo electrónico" required style={inp} autoComplete="email"/>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Contraseña" required style={{...inp,marginBottom:"6px"}} autoComplete="current-password"/>
              {error&&<div style={{fontSize:"0.72rem",color:"#fb7185",marginBottom:"10px",textAlign:"center"}}>{error}</div>}
              <button type="submit" disabled={loading} style={{width:"100%",background:loading?"rgba(2,132,199,0.5)":C.sky6,border:"none",color:"white",padding:"12px",borderRadius:"10px",fontSize:"0.95rem",cursor:loading?"not-allowed":"pointer",fontWeight:700,marginBottom:"12px"}}>
                {loading?"Iniciando sesión...":"Iniciar sesión"}
              </button>
              <button type="button" onClick={handleReset} style={{width:"100%",background:"none",border:"none",color:C.z5,fontSize:"0.75rem",cursor:"pointer",textDecoration:"underline"}}>
                ¿Olvidaste tu contraseña?
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── STUDENT SELECTOR ─────────────────────────────────────────────────────
function StudentSelector({students,selectedId,onSelect}){
  const[open,setOpen]=useState(false);const[search,setSearch]=useState("");
  const current=students.find(s=>s.id===selectedId);
  const filtered=students.filter(s=>s.name.toLowerCase().includes(search.toLowerCase()));
  return(
    <div style={{position:"relative"}}>
      <button onClick={()=>setOpen(!open)} style={{display:"flex",alignItems:"center",gap:"7px",padding:"5px 10px",borderRadius:"9px",border:`1px solid ${C.bg7}`,background:C.bg8,color:C.z2,fontSize:"0.78rem",fontWeight:600,cursor:"pointer"}}>
        <span style={{width:"7px",height:"7px",borderRadius:"50%",background:C.em,flexShrink:0}}/>
        {current?.name||"Seleccionar alumno"}
        <span style={{color:C.z5,fontSize:"0.65rem"}}>{open?"▲":"▼"}</span>
      </button>
      {open&&(
        <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,zIndex:100,background:C.bg9,border:`1px solid ${C.bg7}`,borderRadius:"12px",padding:"8px",minWidth:"220px",maxWidth:"280px",boxShadow:"0 8px 30px rgba(0,0,0,0.5)"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar..." autoFocus
            style={{width:"100%",background:C.bg8,border:`1px solid ${C.bg7}`,borderRadius:"7px",padding:"6px 10px",color:C.z2,fontSize:"0.78rem",outline:"none",marginBottom:"6px"}}/>
          <div style={{maxHeight:"200px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"3px"}}>
            {filtered.map(s=>(
              <button key={s.id} onClick={()=>{onSelect(s.id);setOpen(false);setSearch("");}}
                style={{padding:"8px 10px",borderRadius:"8px",border:"none",background:s.id===selectedId?C.emBg:"transparent",color:s.id===selectedId?C.em2:C.z3,fontSize:"0.8rem",cursor:"pointer",textAlign:"left",fontWeight:s.id===selectedId?700:400}}>{s.name}</button>
            ))}
            {filtered.length===0&&<div style={{color:C.z5,fontSize:"0.75rem",padding:"8px",textAlign:"center"}}>Sin resultados</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────
// CHANGE 1: profesor cannot delete students
// CHANGE 2: phone field added
function AdminPanel({systemConfig,currentUser,onSave,onClose}){
  const role=currentUser.role;
  const[tab,setTab]=useState("students");
  const[students,setStudents]=useState(()=>JSON.parse(JSON.stringify(systemConfig.students||[])));
  const[teacherName,setTeacherName]=useState(systemConfig.teacherName||"");
  const[newName,setNewName]=useState("");
  const[newEmail,setNewEmail]=useState("");
  const[newPhone,setNewPhone]=useState(""); // CHANGE 2
  const[newConfig,setNewConfig]=useState(()=>{const base={...DEFAULT_CONFIG};base.dayTimeOptions=buildDefaultDayTimeOptions(base.weekDays);return base;});
  const[saved,setSaved]=useState(false);
  const[pwEmail,setPwEmail]=useState("");
  const[pwSent,setPwSent]=useState(false);
  const inp={width:"100%",background:C.bg,border:`1px solid ${C.bg7}`,borderRadius:"8px",padding:"7px 10px",color:C.z2,fontSize:"0.875rem",outline:"none",boxSizing:"border-box"};

  function addStudent(){
    if(!newName.trim()||!newEmail.trim())return;
    const id=slugify(newName)+"-"+Date.now().toString(36);
    setStudents([...students,{id,name:newName.trim(),email:newEmail.trim(),phone:newPhone.trim(),config:{...newConfig}}]);
    setNewName("");setNewEmail("");setNewPhone("");
    const base={...DEFAULT_CONFIG};base.dayTimeOptions=buildDefaultDayTimeOptions(base.weekDays);setNewConfig(base);
  }
  // CHANGE 1: only admin can delete
  function removeStudent(id){
    if(role!=="admin")return;
    setStudents(students.filter(s=>s.id!==id));
  }

  async function handleSave(){
    await onSave({...systemConfig,students,teacherName});
    await writeAudit(currentUser,"admin_panel_save",`students:${students.length}`);
    setSaved(true);setTimeout(()=>{setSaved(false);onClose();},700);
  }
  async function handleSendReset(){
    if(!pwEmail.trim())return;
    try{await sendPasswordResetEmail(auth,pwEmail.trim());setPwSent(true);}
    catch{alert("No se pudo enviar el correo.");}
  }

  return(
    <div style={{position:"fixed",inset:0,zIndex:60,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
      <div style={{background:C.bg9,border:`1px solid ${C.bg7}`,borderRadius:"16px",width:"100%",maxWidth:"480px",maxHeight:"88vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"15px 18px",borderBottom:`1px solid ${C.bg7}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{fontSize:"0.95rem",fontWeight:700,color:C.z1}}>⚙️ Panel de Administración</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.z5,cursor:"pointer",fontSize:"1rem"}}>✕</button>
        </div>
        <div style={{display:"flex",gap:"3px",padding:"10px 18px 0",borderBottom:`1px solid ${C.bg7}`}}>
          {[{id:"students",l:"👥 Alumnos"},{id:"password",l:"🔑 Contraseñas"},{id:"config",l:"⚙️ General"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"6px 12px",borderRadius:"8px 8px 0 0",border:"none",background:tab===t.id?C.bg8:"transparent",color:tab===t.id?C.z1:C.z5,fontSize:"0.78rem",fontWeight:600,cursor:"pointer"}}>{t.l}</button>
          ))}
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"16px 18px"}}>

          {tab==="students"&&(
            <div>
              <div style={{fontSize:"0.75rem",color:C.z4,marginBottom:"12px"}}>Alumnos registrados: <strong style={{color:C.z2}}>{students.length}</strong></div>
              <div style={{display:"flex",flexDirection:"column",gap:"6px",marginBottom:"16px"}}>
                {students.map(s=>(
                  <div key={s.id} style={{background:C.bg8,borderRadius:"9px",padding:"10px 12px",display:"flex",alignItems:"center",gap:"10px"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"0.82rem",fontWeight:600,color:C.z2,marginBottom:"1px"}}>{s.name}</div>
                      {/* CHANGE 2: show phone */}
                      <div style={{fontSize:"0.62rem",color:C.z5}}>{s.phone||"sin teléfono"} · {s.email||"sin email"}</div>
                      <div style={{fontSize:"0.62rem",color:C.z6}}>{s.config?.classesPerCycle||12} clases · ${(s.config?.amount||660000).toLocaleString("es-CO")} COP</div>
                    </div>
                    {/* CHANGE 1: only admin sees delete button */}
                    {role==="admin"&&(
                      <button onClick={()=>removeStudent(s.id)} style={{background:C.roseBg,border:`1px solid ${C.roseBd}`,color:"#fb7185",borderRadius:"6px",padding:"3px 8px",fontSize:"0.7rem",cursor:"pointer"}}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              <div style={{borderRadius:"12px",border:`2px dashed ${C.sky6}`,background:"rgba(14,165,233,0.04)",padding:"16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"14px"}}>
                  <div style={{width:"26px",height:"26px",borderRadius:"7px",background:C.skyBg,border:`1px solid ${C.skyBd}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.85rem"}}>➕</div>
                  <div>
                    <div style={{fontSize:"0.85rem",fontWeight:700,color:C.sky}}>Nuevo alumno</div>
                    <div style={{fontSize:"0.62rem",color:C.z5}}>El usuario Auth debe crearse en Firebase Console</div>
                  </div>
                </div>
                {/* CHANGE 2: 3-column grid with phone */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"7px",marginBottom:"8px"}}>
                  <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Nombre completo" style={{...inp,gridColumn:"1/-1"}}/>
                  <input type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder="Email" style={inp}/>
                  <input type="tel" value={newPhone} onChange={e=>setNewPhone(e.target.value)} placeholder="📱 Teléfono" style={inp}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px",marginBottom:"10px"}}>
                  <div><label style={{fontSize:"0.65rem",color:C.z5,display:"block",marginBottom:"3px"}}>Clases por ciclo</label><input type="number" min="1" max="30" value={newConfig.classesPerCycle} onChange={e=>setNewConfig({...newConfig,classesPerCycle:+e.target.value})} style={inp}/></div>
                  <div><label style={{fontSize:"0.65rem",color:C.z5,display:"block",marginBottom:"3px"}}>Monto COP</label><input type="number" value={newConfig.amount} onChange={e=>setNewConfig({...newConfig,amount:+e.target.value})} style={inp}/></div>
                </div>
                <DayTimeEditor config={newConfig} setConfig={setNewConfig}/>
                <button onClick={addStudent} disabled={!newName.trim()||!newEmail.trim()}
                  style={{width:"100%",marginTop:"4px",background:newName.trim()&&newEmail.trim()?C.sky6:"rgba(63,63,70,0.4)",border:"none",color:newName.trim()&&newEmail.trim()?"white":C.z6,padding:"8px",borderRadius:"9px",fontSize:"0.82rem",cursor:"pointer",fontWeight:700}}>
                  Agregar alumno →
                </button>
              </div>
            </div>
          )}

          {tab==="password"&&(
            <div>
              <div style={{fontSize:"0.75rem",color:C.z4,marginBottom:"14px"}}>Envía un correo de restablecimiento de contraseña.</div>
              {pwSent?(
                <div style={{background:C.emBg,border:`1px solid ${C.emBd}`,borderRadius:"10px",padding:"14px",textAlign:"center"}}>
                  <div style={{fontSize:"1.2rem",marginBottom:"6px"}}>📧</div>
                  <div style={{fontSize:"0.85rem",fontWeight:700,color:C.em2,marginBottom:"4px"}}>Correo enviado</div>
                  <div style={{fontSize:"0.72rem",color:C.z4,marginBottom:"10px"}}>El usuario recibirá un enlace para cambiar su contraseña.</div>
                  <button onClick={()=>{setPwSent(false);setPwEmail("");}} style={{background:C.emBg,border:`1px solid ${C.emBd}`,color:C.em2,padding:"6px 16px",borderRadius:"8px",cursor:"pointer",fontSize:"0.8rem"}}>Enviar otro</button>
                </div>
              ):(
                <div>
                  <label style={{fontSize:"0.72rem",color:C.z4,display:"block",marginBottom:"5px"}}>Email del usuario</label>
                  <input type="email" value={pwEmail} onChange={e=>setPwEmail(e.target.value)} placeholder="usuario@email.com"
                    style={{...inp,width:"100%",marginBottom:"10px"}}/>
                  <div style={{display:"flex",flexDirection:"column",gap:"5px",marginBottom:"12px"}}>
                    {[...students.map(s=>({email:s.email,label:`Alumno — ${s.name}`}))].filter(v=>v.email).map(u=>(
                      <button key={u.email} onClick={()=>setPwEmail(u.email)}
                        style={{padding:"6px 10px",borderRadius:"8px",border:`1px solid ${pwEmail===u.email?C.skyBd:C.bg7}`,background:pwEmail===u.email?C.skyBg:C.bg8,color:pwEmail===u.email?C.sky:C.z4,fontSize:"0.72rem",cursor:"pointer",textAlign:"left"}}>
                        {u.label} — {u.email}
                      </button>
                    ))}
                  </div>
                  <button onClick={handleSendReset} disabled={!pwEmail.trim()}
                    style={{width:"100%",background:pwEmail.trim()?C.sky6:"rgba(63,63,70,0.4)",border:"none",color:pwEmail.trim()?"white":C.z6,padding:"8px",borderRadius:"9px",fontSize:"0.85rem",cursor:"pointer",fontWeight:700}}>
                    Enviar correo de restablecimiento
                  </button>
                </div>
              )}
            </div>
          )}

          {tab==="config"&&(
            <div>
              <label style={{fontSize:"0.72rem",color:C.z4,display:"block",marginBottom:"5px"}}>Nombre del profesor</label>
              <input value={teacherName} onChange={e=>setTeacherName(e.target.value)} placeholder="Nombre del profesor" style={{...inp,width:"100%"}}/>
              <div style={{marginTop:"16px",padding:"10px 12px",background:C.bg8,borderRadius:"8px",border:`1px solid ${C.bg7}`}}>
                <div style={{fontSize:"0.72rem",fontWeight:600,color:C.z3,marginBottom:"4px"}}>Sesión actual</div>
                <div style={{fontSize:"0.68rem",color:C.z5}}>{currentUser.email}</div>
                <div style={{fontSize:"0.68rem",color:C.z5}}>{ROLES[currentUser.role]?.label}</div>
              </div>
            </div>
          )}
        </div>
        <div style={{padding:"12px 18px",borderTop:`1px solid ${C.bg7}`,display:"flex",gap:"8px"}}>
          <button onClick={handleSave} style={{flex:1,background:saved?"rgba(5,150,105,0.7)":C.sky6,border:"none",color:"white",padding:"8px",borderRadius:"10px",fontSize:"0.875rem",cursor:"pointer",fontWeight:700}}>
            {saved?"✓ Guardado":"Guardar cambios"}
          </button>
          <button onClick={onClose} style={{flex:1,background:C.bg7,border:"none",color:C.z3,padding:"8px",borderRadius:"10px",fontSize:"0.875rem",cursor:"pointer"}}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ─── TIME SELECTOR ────────────────────────────────────────────────────────
function TimeSelector({value,options,onChange}){
  const[editingIdx,setEditingIdx]=useState(null);
  function selectAgreed(t){onChange(t,options);}
  function editPill(idx,newTime){const o=[...options];o[idx]=newTime;onChange(options[idx]===value?newTime:value,o);}
  return(
    <div>
      <div style={{fontSize:"0.6rem",color:C.z5,marginBottom:"6px"}}>Toca para acordar · ✏️ para editar</div>
      <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
        {options.map((t,idx)=>{const isA=t===value;return(
          <div key={idx} style={{display:"flex",alignItems:"center",borderRadius:"10px",border:`1px solid ${isA?"rgba(16,185,129,0.5)":C.bg7}`,background:isA?"rgba(5,150,105,0.65)":C.bg8}}>
            {editingIdx===idx
              ?<input type="time" value={t} autoFocus onChange={e=>editPill(idx,e.target.value)} onBlur={()=>setEditingIdx(null)} style={{width:"88px",background:"transparent",border:"none",outline:"none",fontSize:"0.75rem",fontWeight:700,padding:"5px 8px",color:isA?"white":C.z2}}/>
              :<button onClick={()=>selectAgreed(t)} style={{fontSize:"0.75rem",fontWeight:700,padding:"5px 9px",background:"transparent",border:"none",cursor:"pointer",color:isA?"white":C.z4}}>
                {fmt12(t)}{isA&&<span style={{fontSize:"0.58rem",color:"rgba(209,250,229,0.6)",marginLeft:"3px",fontWeight:400}}>acordada</span>}
              </button>}
            <button onClick={()=>setEditingIdx(editingIdx===idx?null:idx)} style={{fontSize:"0.6rem",padding:"5px",background:"transparent",border:"none",borderLeft:`1px solid ${isA?"rgba(16,185,129,0.3)":C.bg7}`,cursor:"pointer",color:C.bg6}}>✏️</button>
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
  const ac=accentColor==="rose"?C.rose:C.ora;const acBg=accentColor==="rose"?C.roseBg:C.oraBg;const acBd=accentColor==="rose"?C.roseBd:C.oraBd;
  return(
    <div style={{position:"fixed",inset:0,zIndex:50,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
      <div style={{background:C.bg9,border:`1px solid ${acBd}`,borderRadius:"16px",padding:"20px",width:"100%",maxWidth:"380px"}}>
        <div style={{fontSize:"1rem",fontWeight:700,color:ac,marginBottom:"6px"}}>{title}</div>
        <p style={{fontSize:"0.7rem",color:C.z4,marginBottom:"12px",lineHeight:1.6}} dangerouslySetInnerHTML={{__html:subtitle}}/>
        <div style={{display:"flex",flexWrap:"wrap",gap:"5px",marginBottom:"10px"}}>
          {reasons.map(r=><button key={r} onClick={()=>setReason(r)} style={{fontSize:"0.68rem",padding:"4px 9px",borderRadius:"7px",cursor:"pointer",border:`1px solid ${reason===r?acBd:C.bg7}`,background:reason===r?acBg:C.bg8,color:reason===r?ac:C.z4}}>{r}</button>)}
        </div>
        <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="O escribe el motivo..."
          style={{width:"100%",background:C.bg8,border:`1px solid ${C.bg7}`,borderRadius:"9px",padding:"7px 11px",color:C.z2,fontSize:"0.875rem",outline:"none",marginBottom:"12px",boxSizing:"border-box"}}/>
        <div style={{display:"flex",gap:"8px"}}>
          <button onClick={()=>onConfirm(reason.trim()||"Sin motivo")} style={{flex:1,background:acBg,border:`1px solid ${acBd}`,color:ac,padding:"8px",borderRadius:"10px",fontSize:"0.875rem",cursor:"pointer",fontWeight:700}}>Confirmar</button>
          <button onClick={onClose} style={{flex:1,background:C.bg8,border:`1px solid ${C.bg7}`,color:C.z3,padding:"8px",borderRadius:"10px",fontSize:"0.875rem",cursor:"pointer"}}>Volver</button>
        </div>
      </div>
    </div>
  );
}

function ClassCard({cls,seqNum,role,cycleConfig,onUpdate,onUpdateRecalc,onCancel,onReschedule,isPast}){
  const[editing,setEditing]=useState(false);
  const[showCancel,setShowCancel]=useState(false);
  const[showResched,setShowResched]=useState(false);
  const[localTime,setLocalTime]=useState(cls.time||defaultTime(cls.date,cycleConfig));
  const[timeOpts,setTimeOpts]=useState(cls.timeOptions||defaultTimeOptions(cls.date,cycleConfig));
  const[localDate,setLocalDate]=useState(cls.date);
  const[localType,setLocalType]=useState(cls.type||"presencial");
  const[localNotes,setLocalNotes]=useState(cls.notes||"");
  useEffect(()=>{setLocalTime(cls.time||defaultTime(cls.date,cycleConfig));setTimeOpts(cls.timeOptions||defaultTimeOptions(cls.date,cycleConfig));setLocalDate(cls.date);setLocalType(cls.type||"presencial");setLocalNotes(cls.notes||"");},[cls.id,cls.date,cls.time]);
  const isDone=cls.status==="done",isCanc=cls.status==="cancelled",isReschd=cls.status==="rescheduled",isPend=cls.status==="pending",isToday=isoToday()===cls.date;
  const dayName=DAYS_ES[parseLocal(cls.date).getDay()];
  function save(){const dc=localDate!==cls.date;const newOpts=dc?defaultTimeOptions(localDate,cycleConfig):timeOpts;const newTime=dc?defaultTime(localDate,cycleConfig):localTime;const upd={...cls,time:newTime,timeOptions:newOpts,notes:localNotes,type:localType,date:localDate};if(dc)onUpdateRecalc(upd);else onUpdate(upd);setEditing(false);}
  let cardBg,cardBd,numBg,numColor;
  if(isDone){cardBg="rgba(2,44,34,0.3)";cardBd=C.emBd;numBg=C.emBg;numColor=C.em2;}
  else if(isCanc){cardBg=C.roseBg;cardBd=C.roseBd;numBg="rgba(244,63,94,0.2)";numColor="#fb7185";}
  else if(isReschd){cardBg=C.oraBg;cardBd=C.oraBd;numBg="rgba(249,115,22,0.2)";numColor="#fb923c";}
  else if(isToday){cardBg=C.skyBg;cardBd=C.skyBd;numBg="rgba(14,165,233,0.2)";numColor=C.sky;}
  else{cardBg="rgba(39,39,42,0.45)";cardBd=C.bg7;numBg=C.bg7;numColor=C.z3;}
  const displayOpts=cls.timeOptions||defaultTimeOptions(cls.date,cycleConfig);
  const agreedTime=cls.time||defaultTime(cls.date,cycleConfig);
  const btn={fontSize:"0.68rem",padding:"4px 7px",borderRadius:"7px",cursor:"pointer",fontWeight:600,border:"none"};
  const inpDate={background:C.bg8,border:`1px solid ${C.sky6}`,borderRadius:"7px",padding:"6px 8px",color:C.z1,fontSize:"0.875rem",outline:"none",boxSizing:"border-box",width:"100%",colorScheme:"dark"};
  const inpNorm={background:C.bg,border:`1px solid ${C.bg7}`,borderRadius:"7px",padding:"6px 8px",color:C.z2,fontSize:"0.875rem",outline:"none",boxSizing:"border-box",width:"100%"};
  return(
    <>
      <div style={{background:cardBg,border:`1px solid ${cardBd}`,borderRadius:"11px",opacity:(isPast&&!isDone&&!isCanc&&!isReschd)?0.55:1,transition:"all 0.2s"}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:"9px",padding:"11px"}}>
          <div style={{flexShrink:0,width:"30px",height:"30px",borderRadius:"7px",background:numBg,color:numColor,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.68rem",fontWeight:700}}>{isReschd?"↺":(seqNum??"-")}</div>
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
              <button onClick={()=>onUpdate({...cls,status:"done"})} style={{...btn,background:"rgba(5,150,105,0.7)",color:"white"}}>✓</button>
              <button onClick={()=>setShowCancel(true)} style={{...btn,background:C.roseBg,color:"#fb7185",border:`1px solid ${C.roseBd}`}}>✗</button>
              <button onClick={()=>setShowResched(true)} style={{...btn,background:C.oraBg,color:"#fb923c",border:`1px solid ${C.oraBd}`}}>↺</button>
              <button onClick={()=>setEditing(!editing)} style={{...btn,background:C.bg7,color:C.z3}}>✏️</button>
            </>}
            {isDone&&canManage(role)&&<button onClick={()=>onUpdate({...cls,status:"pending"})} style={{...btn,background:C.bg7,color:C.z3}}>↩</button>}
            {(isCanc||isReschd)&&canManage(role)&&<button onClick={()=>onUpdate({...cls,status:"pending",notes:"",cancelledAt:null,rescheduledAt:null})} style={{...btn,background:C.bg7,color:C.z3}}>↩</button>}
          </div>
        </div>
        {editing&&(
          <div style={{borderTop:`1px solid ${C.bg7}`,padding:"11px",display:"flex",flexDirection:"column",gap:"9px"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px"}}>
              <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"3px"}}>Fecha</label><input type="date" value={localDate} onChange={e=>setLocalDate(e.target.value)} style={inpDate}/></div>
              <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"3px"}}>Modalidad</label>
                <select value={localType} onChange={e=>setLocalType(e.target.value)} style={inpNorm}><option value="presencial">🏋 Presencial</option><option value="virtual">🖥 Virtual</option></select>
              </div>
            </div>
            <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"5px"}}>Horas</label><TimeSelector value={localTime} options={timeOpts} onChange={(a,o)=>{setLocalTime(a);setTimeOpts(o);}}/></div>
            <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"3px"}}>Notas</label><input value={localNotes} onChange={e=>setLocalNotes(e.target.value)} placeholder="observaciones..." style={inpNorm}/></div>
            <div style={{display:"flex",gap:"7px"}}>
              <button onClick={save} style={{flex:1,background:C.sky6,border:"none",color:"white",padding:"7px",borderRadius:"7px",fontSize:"0.875rem",cursor:"pointer",fontWeight:700}}>Guardar</button>
              <button onClick={()=>setEditing(false)} style={{flex:1,background:C.bg7,border:"none",color:C.z3,padding:"7px",borderRadius:"7px",fontSize:"0.875rem",cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
      {showCancel&&<ReasonModal title="Cancelar Clase" subtitle="La clase <strong style='color:#e4e4e7'>sí contabiliza</strong> como slot." accentColor="rose" reasons={CANCEL_REASONS} onConfirm={r=>{onCancel({...cls,status:"cancelled",notes:r,cancelledAt:isoToday()});setShowCancel(false);}} onClose={()=>setShowCancel(false)}/>}
      {showResched&&<ReasonModal title="Reprogramar Clase" subtitle="Por mutuo acuerdo. <strong style='color:#e4e4e7'>NO cuenta</strong> como slot — se agrega reposición." accentColor="orange" reasons={RESCHEDULE_REASONS} onConfirm={r=>{onReschedule({...cls,status:"rescheduled",notes:r,rescheduledAt:isoToday()});setShowResched(false);}} onClose={()=>setShowResched(false)}/>}
    </>
  );
}

function NewCycleCard({studentConfig,onAdd}){
  const[startDate,setStartDate]=useState(isoToday());
  const[config,setConfig]=useState(()=>{const base={...studentConfig};if(!base.dayTimeOptions)base.dayTimeOptions=buildDefaultDayTimeOptions(base.weekDays);return base;});
  const inp={width:"100%",background:C.bg,border:`1px solid ${C.bg7}`,borderRadius:"8px",padding:"7px 10px",color:C.z2,fontSize:"0.875rem",outline:"none",boxSizing:"border-box"};
  return(
    <div style={{borderRadius:"14px",border:`2px dashed ${C.sky6}`,background:"rgba(14,165,233,0.04)",padding:"20px"}}>
      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"16px"}}>
        <div style={{width:"28px",height:"28px",borderRadius:"8px",background:C.skyBg,border:`1px solid ${C.skyBd}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.9rem"}}>📅</div>
        <div><div style={{fontSize:"0.9rem",fontWeight:700,color:C.sky}}>Crear primer ciclo</div><div style={{fontSize:"0.65rem",color:C.z5}}>Configura el ciclo, días y horarios</div></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"14px"}}>
        <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"4px"}}>Fecha de inicio</label><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={{...inp,background:C.bg8,border:`1px solid ${C.sky6}`,color:C.z1,colorScheme:"dark"}}/></div>
        <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"4px"}}>Clases por ciclo</label><input type="number" min="1" max="30" value={config.classesPerCycle} onChange={e=>setConfig({...config,classesPerCycle:+e.target.value})} style={inp}/></div>
        <div><label style={{fontSize:"0.68rem",color:C.z4,display:"block",marginBottom:"4px"}}>Monto (COP)</label><input type="number" value={config.amount} onChange={e=>setConfig({...config,amount:+e.target.value})} style={inp}/></div>
      </div>
      <DayTimeEditor config={config} setConfig={setConfig}/>
      <button onClick={()=>onAdd(startDate,config)} disabled={config.weekDays.length===0}
        style={{width:"100%",marginTop:"4px",background:config.weekDays.length>0?C.sky6:"rgba(63,63,70,0.4)",border:"none",color:config.weekDays.length>0?"white":C.z6,padding:"10px",borderRadius:"10px",fontSize:"0.875rem",cursor:config.weekDays.length>0?"pointer":"not-allowed",fontWeight:700}}>
        Crear ciclo →
      </button>
    </div>
  );
}

const DAY_OPT=[{v:1,l:"Lun"},{v:2,l:"Mar"},{v:3,l:"Mié"},{v:4,l:"Jue"},{v:5,l:"Vie"},{v:6,l:"Sáb"},{v:0,l:"Dom"}];

// CHANGE 5: isCurrent controls showAll default → always start collapsed (false)
function CycleCard({cycle,cycleIndex,isCurrent,role,onUpdateCycle,onUpdateClass,onUpdateClassRecalc,onCancelClass,onRescheduleClass,onResetCycle,onDeleteCycle}){
  const target=cycle.config.classesPerCycle;
  const done=doneCount(cycle.classes),cancelled=cancelledCount(cycle.classes),reschd=rescheduledCount(cycle.classes);
  const remaining=Math.max(0,target-done-cancelled);
  const seqNums=buildSeqNums(cycle.classes,target);
  const allPending=cycle.classes.every(c=>c.status==="pending");
  const hasRegistered=cycle.classes.some(c=>c.status!=="pending");
  const canEditConfig=canManage(role)||(role==="alumno"&&!hasRegistered);
  const[editingConfig,setEditingConfig]=useState(false);
  const[localConfig,setLocalConfig]=useState({...cycle.config});
  const[showAll,setShowAll]=useState(false); // CHANGE 5: always start collapsed
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
            <div style={{fontSize:"0.68rem",color:C.z4}}>{formatDate(cycle.classes[0]?.date||cycle.startDate)} → {formatDate(cycle.classes[cycle.classes.length-1]?.date||cycle.endDate)}</div>
          </div>
          {canManage(role)&&<button onClick={()=>onUpdateCycle({...cycle,paid:!cycle.paid})} style={{flexShrink:0,padding:"5px 11px",borderRadius:"9px",fontSize:"0.78rem",fontWeight:700,cursor:"pointer",border:"none",background:cycle.paid?"rgba(5,150,105,0.65)":C.bg8,color:cycle.paid?"white":C.z3}}>{cycle.paid?"💳 Pagado":"💰 Sin Pagar"}</button>}
        </div>
        <div style={{marginTop:"10px"}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.7rem",marginBottom:"5px"}}>
            <span><span style={{color:C.em,fontWeight:700}}>{done} realizadas</span>{cancelled>0&&<span style={{color:C.rose,marginLeft:"7px"}}>{cancelled} canceladas</span>}{reschd>0&&<span style={{color:C.ora,marginLeft:"7px"}}>{reschd} reprog.</span>}</span>
            <span style={{color:remaining>0?C.amb:C.em,fontWeight:700}}>{remaining>0?`${remaining} pendientes`:"✓ Completado"}</span>
          </div>
          <div style={{height:"7px",background:C.bg8,borderRadius:"999px",overflow:"hidden"}}>
            <div style={{height:"100%",display:"flex"}}>
              <div style={{background:C.em,width:`${Math.round((done/target)*100)}%`,transition:"width 0.5s"}}/>
              <div style={{background:"rgba(244,63,94,0.55)",width:`${Math.round((cancelled/target)*100)}%`,transition:"width 0.5s"}}/>
            </div>
          </div>
          <div style={{display:"flex",gap:"2px",marginTop:"5px"}}>
            {Array.from({length:target}).map((_,i)=><div key={i} style={{height:"4px",flex:1,borderRadius:"999px",background:i<done?C.em:i<done+cancelled?"rgba(244,63,94,0.5)":C.bg7}}/>)}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:"8px"}}>
          <span style={{fontSize:"0.65rem",color:C.z5}}>${cycle.amount?.toLocaleString("es-CO")} COP · {target} clases{reschd>0&&<span style={{color:C.ora,marginLeft:"3px"}}>· +{reschd} repos.</span>}</span>
          <div style={{display:"flex",gap:"5px"}}>
            {canManage(role)&&<button onClick={()=>allPending&&setConfirmDelete(true)} style={{...btnSm,background:allPending?C.roseBg:"rgba(63,63,70,0.2)",color:allPending?"#fb7185":C.z6,border:`1px solid ${allPending?C.roseBd:C.bg7}`,...(!allPending&&btnDisabled)}}>🗑️</button>}
            {canManage(role)&&<button onClick={()=>allPending&&setConfirmReset(true)} style={{...btnSm,background:allPending?C.ambBg:"rgba(63,63,70,0.2)",color:allPending?C.amb:C.z6,border:`1px solid ${allPending?C.ambBd:C.bg7}`,...(!allPending&&btnDisabled)}}>🔄</button>}
            {canEditConfig&&<button onClick={()=>setEditingConfig(!editingConfig)} style={btnSm}>⚙️</button>}
            <button onClick={()=>setShowAll(!showAll)} style={btnSm}>{showAll?"▲ Menos":"▼ Ver clases"}</button>
          </div>
        </div>
      </div>
      {confirmReset&&(
        <div style={{position:"fixed",inset:0,zIndex:50,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
          <div style={{background:C.bg9,border:`1px solid ${C.ambBd}`,borderRadius:"14px",padding:"18px",width:"100%",maxWidth:"370px"}}>
            <div style={{fontSize:"0.95rem",fontWeight:700,color:C.amb,marginBottom:"7px"}}>🔄 Reiniciar Ciclo {cycleIndex+1}</div>
            <p style={{fontSize:"0.7rem",color:C.z4,marginBottom:"14px",lineHeight:1.6}}>Se regeneran todas las clases.<br/><strong style={{color:"#fb7185"}}>Todas las clases actuales serán reemplazadas.</strong></p>
            <div style={{display:"flex",gap:"7px"}}>
              <button onClick={()=>{onResetCycle();setConfirmReset(false);}} style={{flex:1,background:C.ambBg,border:`1px solid ${C.ambBd}`,color:C.amb,padding:"7px",borderRadius:"9px",fontSize:"0.875rem",cursor:"pointer",fontWeight:700}}>Sí, reiniciar</button>
              <button onClick={()=>setConfirmReset(false)} style={{flex:1,background:C.bg8,border:`1px solid ${C.bg7}`,color:C.z3,padding:"7px",borderRadius:"9px",fontSize:"0.875rem",cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete&&(
        <div style={{position:"fixed",inset:0,zIndex:50,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
          <div style={{background:C.bg9,border:`1px solid ${C.roseBd}`,borderRadius:"14px",padding:"18px",width:"100%",maxWidth:"370px"}}>
            <div style={{fontSize:"0.95rem",fontWeight:700,color:"#fb7185",marginBottom:"7px"}}>🗑️ Eliminar Ciclo {cycleIndex+1}</div>
            <p style={{fontSize:"0.7rem",color:C.z4,marginBottom:"14px",lineHeight:1.6}}>Esta acción <strong style={{color:"#fb7185"}}>elimina permanentemente</strong> este ciclo.</p>
            <div style={{display:"flex",gap:"7px"}}>
              <button onClick={()=>{onDeleteCycle();setConfirmDelete(false);}} style={{flex:1,background:C.roseBg,border:`1px solid ${C.roseBd}`,color:"#fb7185",padding:"7px",borderRadius:"9px",fontSize:"0.875rem",cursor:"pointer",fontWeight:700}}>Sí, eliminar</button>
              <button onClick={()=>setConfirmDelete(false)} style={{flex:1,background:C.bg8,border:`1px solid ${C.bg7}`,color:C.z3,padding:"7px",borderRadius:"9px",fontSize:"0.875rem",cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
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
      {showAll&&(
        <div style={{borderTop:`1px solid ${C.bg7}`,padding:"14px",display:"flex",flexDirection:"column",gap:"7px"}}>
          <div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",fontSize:"0.6rem",color:C.z5,paddingBottom:"7px",borderBottom:`1px solid ${C.bg8}`}}>
            <span>🟢 Realizada → cuenta slot</span><span>🔴 Cancelada → cuenta slot</span><span>🟠 Reprogramada → NO cuenta + reposición ⚡</span>
          </div>
          {cycle.classes.map((cls,i)=>(
            <ClassCard key={cls.id} cls={cls} seqNum={seqNums[i]} isPast={cls.date<isoToday()} role={role} cycleConfig={cycle.config}
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

// ─── MAIN APP ─────────────────────────────────────────────────────────────
export default function App(){
  const[currentUser,setCurrentUser]=useState(null);
  const[authLoading,setAuthLoading]=useState(true);
  const[systemConfig,setSystemConfig]=useState(DEFAULT_SYSTEM);

  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async firebaseUser=>{
      if(firebaseUser){
        const token=await firebaseUser.getIdTokenResult();
        const role=token.claims.role;
        if(role)setCurrentUser({uid:firebaseUser.uid,email:firebaseUser.email,role});
        else setCurrentUser(null);
      }else{setCurrentUser(null);}
      setAuthLoading(false);
    });
    return()=>unsub();
  },[]);

  useEffect(()=>{
  const unsub=onSnapshot(SYSTEM_REF(),snap=>{
    if(snap.exists()){
      const d=snap.data();
      // Soporta payload.students, students directo, o array en raíz
      const payload=d.payload||d;
      // Si students es un objeto con keys numéricas (array guardado como map)
      let students=payload.students;
      if(students&&!Array.isArray(students)){
        students=Object.values(students);
      }
      
setSystemConfig({...payload, students: students||[]});
    }
  },()=>{});
  return()=>unsub();
},[]);

  async function handleLogout(){
    if(currentUser)await writeAudit(currentUser,"logout","");
    await signOut(auth);setCurrentUser(null);
  }

  if(authLoading)return(
    <div style={{minHeight:"100vh",background:"#09090b",display:"flex",alignItems:"center",justifyContent:"center",color:"#71717a",fontFamily:"system-ui"}}>Cargando...</div>
  );
  if(!currentUser)return<LoginScreen onLogin={setCurrentUser}/>;
  return<AppMain currentUser={currentUser} systemConfig={systemConfig}
    onSystemSave={async cfg=>{setSystemConfig(cfg);await saveSystemConfig(cfg,currentUser);await writeAudit(currentUser,"system_config_saved","");}}
    onLogout={handleLogout}/>;
}

function AppMain({currentUser,systemConfig,onSystemSave,onLogout}){
  const[studentData,setStudentData]=useState(null);
  const[selectedStudentId,setSelectedStudentId]=useState(null);
  const[loading,setLoading]=useState(true);
  const[saving,setSaving]=useState(false);
  const[lastSaved,setLastSaved]=useState(null);
  const[tab,setTab]=useState("cycles");
  const[showAdmin,setShowAdmin]=useState(false);
  const unsubStudent=useRef(null);
  const role=currentUser.role;

  useEffect(()=>{
    const studentId=role==="alumno"?currentUser.uid:selectedStudentId;
    if(!studentId){setStudentData(null);setLoading(false);return;}
    if(unsubStudent.current)unsubStudent.current();
    setLoading(true);
    const unsub=onSnapshot(STUDENT_REF(studentId),async snap=>{
      if(snap.exists()){setStudentData(sanitizeCycles(snap.data().payload||snap.data()));setLastSaved(snap.data().updatedAt);}
      else if(canManage(role)){
        const student=systemConfig.students?.find(s=>s.id===studentId);
        const init=initStudentData(student||{name:studentId,config:DEFAULT_CONFIG});
        init.teacherName=systemConfig.teacherName||"";
        setStudentData(init);await saveStudentData(studentId,init,currentUser);
      }
      setLoading(false);
    },err=>{console.error("Student data error:",err);setLoading(false);});
    unsubStudent.current=unsub;return()=>unsub();
  },[role,selectedStudentId,currentUser.uid,systemConfig?.teacherName]);

  useEffect(()=>{
  if(canManage(role)&&!selectedStudentId&&systemConfig?.students?.length>0){
    setSelectedStudentId(systemConfig.students[0].id);
  }
},[role, systemConfig?.students?.length, systemConfig?.students?.[0]?.id]);

  const currentStudentId=role==="alumno"?currentUser.uid:selectedStudentId;
  const currentStudentObj=systemConfig.students?.find(s=>s.id===currentStudentId);

  async function persist(nd){
    if(!currentStudentId)return;
    const clean=sanitizeCycles(nd);
    setStudentData(clean);setSaving(true);
    await saveStudentData(currentStudentId,clean,currentUser);
    setSaving(false);setLastSaved(new Date().toISOString());
  }

  function updateCycle(idx,upd){const c=[...studentData.cycles];c[idx]=upd;persist({...studentData,cycles:c});}
  function updateClass(ci,li,upd){const cycles=[...studentData.cycles];const cls=[...cycles[ci].classes];cls[li]=upd;cycles[ci]={...cycles[ci],classes:cls};persist({...studentData,cycles});}
  function updateClassRecalc(ci,li,upd){
    const cycles=[...studentData.cycles];let cls=[...cycles[ci].classes];
    cls[li]=upd;cls=recalcForward(cls,li,cycles[ci].config);
    cycles[ci]={...cycles[ci],classes:cls,startDate:cls[0]?.date||cycles[ci].startDate,endDate:cls[cls.length-1]?.date||cycles[ci].endDate,name:cycleName(cls)};
    persist({...studentData,cycles});
  }
  function cancelClass(ci,li,cancelled){const cycles=[...studentData.cycles];const cls=[...cycles[ci].classes];cls[li]=cancelled;cycles[ci]={...cycles[ci],classes:cls};persist({...studentData,cycles});}
  function rescheduleClass(ci,li,reschd){
    const cycles=[...studentData.cycles];const cycle=cycles[ci];let cls=[...cycle.classes];
    cls[li]=reschd;const activeSlots=cls.filter(c=>c.status!=="rescheduled").length;
    if(activeSlots<cycle.config.classesPerCycle)cls.push(makeMakeup(cls,cycle.config));
    cycles[ci]={...cycle,classes:cls,endDate:cls[cls.length-1].date,name:cycleName(cls)};persist({...studentData,cycles});
  }
  function resetCycle(cycleIdx){
    const cycles=[...studentData.cycles];const cycle=cycles[cycleIdx];const config=cycle.config;
    const prevCycle=cycles[cycleIdx-1];
    const prevLastDate=prevCycle?prevCycle.classes.reduce((mx,c)=>c.date>mx?c.date:mx,"1970-01-01"):isoToday();
    const freshStart=nextValidDay(addDays(prevLastDate,1),config.weekDays);
    const newClasses=[];let cursor=freshStart;
    while(newClasses.length<config.classesPerCycle){
      if(config.weekDays.includes(dow(cursor))){const opts=defaultTimeOptions(cursor,config);newClasses.push({id:`cls-${Date.now()}-${newClasses.length}-${Math.random().toString(36).slice(2,5)}`,date:cursor,time:opts[0],timeOptions:opts,status:"pending",type:"presencial",notes:""});}
      cursor=addDays(cursor,1);
    }
    cycles[cycleIdx]={...cycle,classes:newClasses,startDate:newClasses[0].date,endDate:newClasses[newClasses.length-1].date,name:cycleName(newClasses)};
    persist({...studentData,cycles});
  }
  function deleteCycle(idx){persist({...studentData,cycles:studentData.cycles.filter((_,i)=>i!==idx)});}
  function addNextCycle(){
    const last=studentData.cycles[studentData.cycles.length-1];if(!last)return;
    const config=last.config||DEFAULT_CONFIG;
    const lastClassDate=last.classes.reduce((mx,c)=>c.date>mx?c.date:mx,"1970-01-01");
    persist({...studentData,cycles:[...studentData.cycles,buildCycle(nextValidDay(addDays(lastClassDate,1),config.weekDays),config,Date.now())]});
  }
  function addFirstCycle(startDate,config){
    persist({...studentData,cycles:[buildCycle(nextValidDay(startDate,config.weekDays),config,Date.now())],globalConfig:{...studentData.globalConfig,...config}});
  }
  function exportCSV(){
    if(!studentData)return;
    const rows=[["Ciclo","Estudiante","Profesor","#","Fecha","Hora","Estado","Modalidad","Notas","Pago","Monto"]];
    studentData.cycles.forEach((cy,ci)=>{const seqs=buildSeqNums(cy.classes,cy.config.classesPerCycle);cy.classes.forEach((c,i)=>rows.push([ci+1,studentData.studentName,studentData.teacherName,seqs[i]??"↺",c.date,c.time,c.status,c.type,c.notes||"",cy.paid?"Pagado":"Pendiente",cy.amount]));});
    const csv=rows.map(r=>r.map(v=>`"${String(v)}"`).join(",")).join("\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`gymtrack_${(studentData.studentName||"export").replace(/\s+/g,"_")}.csv`;a.click();URL.revokeObjectURL(url);
  }

  const isLoadingData=loading||(!studentData&&!!currentStudentId);
  const currentIdx=studentData?studentData.cycles.findIndex(c=>(doneCount(c.classes)+cancelledCount(c.classes))<c.config.classesPerCycle):-1;
  const displayIdx=currentIdx===-1?(studentData?.cycles.length-1||0):currentIdx;
  const curCycle=studentData?.cycles[displayIdx];
  const totalDone=studentData?.cycles.reduce((s,c)=>s+doneCount(c.classes),0)||0;
  const totalTarget=studentData?.cycles.reduce((s,c)=>s+c.config.classesPerCycle,0)||0;
  const remaining=curCycle?Math.max(0,curCycle.config.classesPerCycle-doneCount(curCycle.classes)-cancelledCount(curCycle.classes)):0;
  const btnA={fontSize:"0.7rem",padding:"5px 9px",borderRadius:"7px",cursor:"pointer",border:"none",background:C.bg8,color:C.z4};
  const roleColor=ROLES[role]?.color||C.z4;

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.z1,fontFamily:"'DM Sans',system-ui,sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}body{margin:0;padding:0;background:#09090b;}input,select,button{font-family:inherit;-webkit-appearance:none;appearance:none;}input[type=date],input[type=time]{-webkit-appearance:none;color-scheme:dark;}`}</style>

      {showAdmin&&<AdminPanel systemConfig={systemConfig} currentUser={currentUser} onSave={onSystemSave} onClose={()=>setShowAdmin(false)}/>}

      {/* Topbar */}
      <div style={{position:"sticky",top:0,zIndex:40,background:"rgba(9,9,11,0.93)",backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)",borderBottom:`1px solid ${C.bg8}`}}>
        <div style={{maxWidth:"680px",margin:"0 auto",padding:"9px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px"}}>
          <div style={{display:"flex",alignItems:"center",gap:"9px",minWidth:0}}>
            {/* CHANGE 4: gray logo in topbar */}
            <GymLogo size="sm"/>
            <div style={{minWidth:0}}>
              <div style={{fontSize:"0.85rem",fontWeight:700,lineHeight:1}}>by Juappnerí</div>
              <div style={{fontSize:"0.62rem",color:C.z5,lineHeight:1,marginTop:"2px",display:"flex",alignItems:"center",gap:"5px",flexWrap:"wrap"}}>
                <span>{currentUser.email}</span>
                <span style={{padding:"1px 6px",borderRadius:"999px",fontSize:"0.58rem",fontWeight:700,background:roleColor+"22",color:roleColor,border:`1px solid ${roleColor}44`,flexShrink:0}}>{ROLES[role]?.label}</span>
              </div>
            </div>
          </div>
          {canManage(role)&&systemConfig.students?.length>0&&(<StudentSelector students={systemConfig.students} selectedId={selectedStudentId} onSelect={id=>{setSelectedStudentId(id);setTab("cycles");setLoading(true);}}/>)}
          <div style={{display:"flex",alignItems:"center",gap:"5px",flexShrink:0}}>
            {saving?<span style={{fontSize:"0.6rem",color:C.sky}}>💾</span>:lastSaved&&<span style={{fontSize:"0.6rem",color:C.z6}}>✓</span>}
            {canManage(role)&&<button onClick={exportCSV} style={btnA} title="Exportar clases CSV">⬇️</button>}
            {/* CHANGE 3: export students button for admin and profesor */}
            {canManage(role)&&<button onClick={()=>exportStudentsCSV(systemConfig)} style={{...btnA,color:C.em2}} title="Exportar directorio alumnos">👥⬇️</button>}
            {canManage(role)&&<button onClick={()=>setShowAdmin(true)} style={btnA} title="Administración">⚙️</button>}
            <button onClick={onLogout} style={{...btnA,color:"#fb7185"}} title="Cerrar sesión">⏏️</button>
          </div>
        </div>
      </div>

      <div style={{maxWidth:"680px",margin:"0 auto",padding:"18px 14px",display:"flex",flexDirection:"column",gap:"14px"}}>
        {canManage(role)&&!currentStudentId&&(<div style={{textAlign:"center",padding:"40px 20px",color:C.z5,fontSize:"0.875rem"}}>Selecciona un alumno para ver su seguimiento</div>)}
        {isLoadingData&&currentStudentId&&(<div style={{textAlign:"center",padding:"40px",color:C.z4}}><div>Cargando datos...</div></div>)}
        {!isLoadingData&&studentData&&(
          <>
            {canManage(role)&&(
              <div style={{background:"rgba(14,165,233,0.07)",border:`1px solid ${C.skyBd}`,borderRadius:"10px",padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div><div style={{fontSize:"0.7rem",color:C.z5,marginBottom:"2px"}}>Viendo datos de</div><div style={{fontSize:"0.95rem",fontWeight:700,color:C.sky}}>{studentData.studentName}</div></div>
                <div style={{fontSize:"0.68rem",color:C.z5,textAlign:"right"}}><div>{currentStudentObj?.config?.classesPerCycle||12} clases/ciclo</div><div>${(currentStudentObj?.config?.amount||660000).toLocaleString("es-CO")} COP</div></div>
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"7px"}}>
              {[{label:"Realizadas",value:totalDone,sub:`de ${totalTarget}`,color:C.em},{label:"Pendientes",value:remaining,sub:"ciclo actual",color:C.amb},{label:"Ciclos",value:studentData.cycles.length,sub:"programados",color:C.sky},{label:curCycle?.name||"-",value:curCycle?.paid?"✓":"$",sub:curCycle?.paid?"Pagado":"Sin pagar",color:curCycle?.paid?C.em:C.rose}].map((s,i)=>(
                <div key={i} style={{background:"rgba(24,24,27,0.7)",border:`1px solid ${C.bg7}`,borderRadius:"11px",padding:"11px",textAlign:"center"}}>
                  <div style={{fontSize:"1.35rem",fontWeight:800,color:s.color,lineHeight:1}}>{s.value}</div>
                  <div style={{fontSize:"0.62rem",color:C.z5,marginTop:"3px"}}>{s.label}</div>
                  <div style={{fontSize:"0.58rem",color:C.z6,marginTop:"2px"}}>{s.sub}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:"3px",background:C.bg9,borderRadius:"11px",padding:"3px"}}>
              {[{id:"cycles",label:"📅 Ciclos"},{id:"history",label:"📊 Historial"}].map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:"7px",borderRadius:"8px",fontSize:"0.85rem",fontWeight:600,cursor:"pointer",border:"none",background:tab===t.id?C.bg7:"transparent",color:tab===t.id?C.z1:C.z5}}>{t.label}</button>
              ))}
            </div>
            {tab==="cycles"&&(
              <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
                {studentData.cycles.length===0&&canManage(role)&&(<NewCycleCard studentConfig={currentStudentObj?.config||DEFAULT_CONFIG} onAdd={addFirstCycle}/>)}
                {studentData.cycles.length===0&&!canManage(role)&&(<div style={{textAlign:"center",padding:"40px 20px",color:C.z5,fontSize:"0.875rem"}}>No hay ciclos programados aún.</div>)}
                {studentData.cycles.map((cycle,idx)=>(
                  <CycleCard key={cycle.id} cycle={cycle} cycleIndex={idx} isCurrent={idx===displayIdx} role={role}
                    onUpdateCycle={upd=>updateCycle(idx,upd)} onUpdateClass={updateClass}
                    onUpdateClassRecalc={updateClassRecalc} onCancelClass={cancelClass}
                    onRescheduleClass={rescheduleClass} onResetCycle={()=>resetCycle(idx)} onDeleteCycle={()=>deleteCycle(idx)}/>
                ))}
                {canManage(role)&&studentData.cycles.length>0&&<button onClick={addNextCycle} style={{padding:"11px",borderRadius:"14px",border:`2px dashed ${C.bg7}`,background:"transparent",color:C.z5,fontSize:"0.85rem",cursor:"pointer"}}>+ Agregar ciclo siguiente</button>}
              </div>
            )}
            {tab==="history"&&(
              <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
                <div style={{fontSize:"0.85rem",fontWeight:600,color:C.z4}}>Historial completo</div>
                {studentData.cycles.map((cycle,ci)=>{
                  const done=doneCount(cycle.classes),canc=cancelledCount(cycle.classes),resc=rescheduledCount(cycle.classes),pend=cycle.classes.filter(c=>c.status==="pending").length;
                  const presencial=cycle.classes.filter(c=>c.type==="presencial"&&(c.status==="done"||c.status==="cancelled")).length;
                  const virtual=cycle.classes.filter(c=>c.type==="virtual"&&(c.status==="done"||c.status==="cancelled")).length;
                  return(
                    <div key={cycle.id} style={{background:"rgba(24,24,27,0.7)",border:`1px solid ${C.bg7}`,borderRadius:"11px",padding:"14px"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
                        <span style={{fontWeight:700,color:C.z1,fontSize:"0.9rem"}}>Ciclo {ci+1}: {cycle.name}</span>
                        <Badge label={cycle.paid?"💳 Pagado":"💰 Sin pagar"} color={cycle.paid?"green":"yellow"}/>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:"5px",marginBottom:"8px"}}>
                        {[{v:done,l:"Realizadas",c:C.em,bg:C.emBg,bd:C.emBd},{v:resc,l:"Reprogramadas",c:C.ora,bg:C.oraBg,bd:C.oraBd},{v:canc,l:"Canceladas",c:"#fb7185",bg:C.roseBg,bd:C.roseBd},{v:pend,l:"Pendientes",c:C.amb,bg:C.ambBg,bd:C.ambBd}].map((s,i)=>(
                          <div key={i} style={{flex:"1 1 calc(25% - 4px)",minWidth:"70px",background:s.bg,border:`1px solid ${s.bd}`,borderRadius:"8px",padding:"7px 6px",textAlign:"center"}}>
                            <div style={{fontSize:"1.1rem",fontWeight:800,color:s.c,lineHeight:1}}>{s.v}</div>
                            <div style={{fontSize:"0.58rem",color:C.z4,marginTop:"3px",lineHeight:1.2}}>{s.l}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{display:"flex",gap:"5px",marginBottom:"8px"}}>
                        <div style={{flex:1,background:C.skyBg,border:`1px solid ${C.skyBd}`,borderRadius:"8px",padding:"7px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <span style={{fontSize:"0.72rem",color:C.z4}}>🏋 Presenciales</span><span style={{fontSize:"0.9rem",fontWeight:700,color:C.sky}}>{presencial}</span>
                        </div>
                        <div style={{flex:1,background:C.vioBg,border:`1px solid ${C.vioBd}`,borderRadius:"8px",padding:"7px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <span style={{fontSize:"0.72rem",color:C.z4}}>🖥 Virtuales</span><span style={{fontSize:"0.9rem",fontWeight:700,color:C.vio}}>{virtual}</span>
                        </div>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:"7px",borderTop:`1px solid ${C.bg8}`}}>
                        <span style={{fontSize:"0.65rem",color:C.z5}}>📅 {formatDate(cycle.startDate)} → {formatDate(cycle.endDate)}</span>
                        <span style={{fontSize:"0.72rem",fontWeight:700,color:C.sky}}>${(cycle.amount||0).toLocaleString("es-CO")} COP</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
