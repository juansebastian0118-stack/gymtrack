
import { useState, useEffect, useCallback, useRef } from "react";
import { db } from "./firebase.js";
import { doc, onSnapshot, setDoc, getDoc } from "firebase/firestore";

// ─── DATE HELPERS (timezone-safe) ─────────────────────────────────────────
const DAYS_ES    = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MONTHS_ES  = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MONTHS_SH  = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function parseLocal(iso) {
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(y, m-1, d);
}
function isoDate(date) {
  const d = typeof date==="string" ? parseLocal(date) : date;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function addDays(iso, n) {
  const d = parseLocal(iso);
  d.setDate(d.getDate()+n);
  return isoDate(d);
}
function formatDate(iso) {
  if (!iso) return "";
  const d = parseLocal(iso);
  return `${String(d.getDate()).padStart(2,"0")}-${MONTHS_SH[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}
function dow(iso) { return parseLocal(iso).getDay(); }
function nextValidDay(iso, weekDays) {
  let c = iso;
  while (!weekDays.includes(dow(c))) c = addDays(c,1);
  return c;
}

// ─── TIME HELPERS ─────────────────────────────────────────────────────────
function defaultTimeOptions(isoDateStr) {
  // Saturday (6) → start at 7AM; otherwise → start at 5AM
  return dow(isoDateStr) === 6 ? ["07:00","08:00","09:00"] : ["05:00","06:00","07:00"];
}
function defaultTime(isoDateStr) { return defaultTimeOptions(isoDateStr)[0]; }
function fmt12(t) {
  if (!t) return "";
  const [h,m] = t.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const hh = h===0?12:h>12?h-12:h;
  return `${hh}${m?":"+String(m).padStart(2,"0"):""}${ap}`;
}

// ─── STATUS MODEL ─────────────────────────────────────────────────────────
// "pending"     → programada pendiente          → ocupa slot activo
// "done"        → realizada ✓                   → CUENTA para ciclo
// "cancelled"   → cancelada (unilateral)        → CUENTA como slot usado (no repone)
//                 queda visible en historial con motivo
// "rescheduled" → reprogramada (mutuo acuerdo)  → NO cuenta, NO ocupa slot
//                 queda visible en historial, se añade clase de reposición

function doneCount(classes)        { return classes.filter(c=>c.status==="done").length; }
function cancelledCount(classes)   { return classes.filter(c=>c.status==="cancelled").length; }
function rescheduledCount(classes) { return classes.filter(c=>c.status==="rescheduled").length; }

// Sequence numbers: only pending / done / cancelled classes get 1, 2, 3 …
// rescheduled rows get null (shown as ↺, they do NOT consume a sequence number).
// The counter is capped at classesPerCycle so makeup/extra slots beyond the
// target still show their real number but never creates an impossible "13 of 12".
function buildSeqNums(classes, classesPerCycle) {
  let n = 0;
  return classes.map(c => {
    if (c.status === "rescheduled") return null; // ↺ — no number
    n++;
    // Makeup classes that push beyond the target keep counting from target+1
    // only if they are genuine extra slots (isMakeup). Regular pending classes
    // inside the original 12 stay within 1-12.
    return n;
  });
}

// ─── CYCLE HELPERS ────────────────────────────────────────────────────────
function cycleName(classes) {
  const counts = {};
  classes.forEach(c => { const m=parseLocal(c.date).getMonth(); counts[m]=(counts[m]||0)+1; });
  const dom = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  return dom ? MONTHS_ES[dom[0]] : "Nuevo Ciclo";
}

function generateClasses(startIso, config) {
  const { classesPerCycle, weekDays } = config;
  const classes = [];
  let cursor = startIso;
  while (classes.length < classesPerCycle) {
    if (weekDays.includes(dow(cursor))) {
      classes.push({
        id: `cls-${Date.now()}-${classes.length}-${Math.random().toString(36).slice(2,5)}`,
        date: cursor,
        time: defaultTime(cursor),
        status: "pending",
        type: "presencial",
        notes: "",
      });
    }
    cursor = addDays(cursor,1);
  }
  return classes;
}

function buildCycle(startIso, config, idx) {
  const classes = generateClasses(startIso, config);
  return {
    id: `cycle-${Date.now()}-${idx}`,
    name: cycleName(classes),
    classes,
    paid: false,
    amount: config.amount,
    config: { ...config },
    startDate: classes[0]?.date,
    endDate:   classes[classes.length-1]?.date,
  };
}

// Recalculate dates of pending classes after changedIdx
function recalcForward(classes, changedIdx, config) {
  const updated = [...classes];
  let cursor = addDays(updated[changedIdx].date, 1);
  for (let i = changedIdx+1; i < updated.length; i++) {
    const s = updated[i].status;
    if (s==="done"||s==="cancelled"||s==="rescheduled") continue;
    while (!config.weekDays.includes(dow(cursor))) cursor = addDays(cursor,1);
    updated[i] = { ...updated[i], date: cursor, time: defaultTime(cursor) };
    cursor = addDays(cursor,1);
  }
  return updated;
}

// Create a makeup class after the last class in the cycle
function makeMakeup(classes, config) {
  const lastDate = classes.reduce((mx,c)=>c.date>mx?c.date:mx,"1970-01-01");
  let cursor = addDays(lastDate, 1);
  while (!config.weekDays.includes(dow(cursor))) cursor = addDays(cursor,1);
  return {
    id: `cls-${Date.now()}-mx-${Math.random().toString(36).slice(2,5)}`,
    date: cursor,
    time: defaultTime(cursor),
    status: "pending",
    type: "presencial",
    notes: "",
    isMakeup: true,
  };
}

// ─── FIREBASE PERSISTENCE ────────────────────────────────────────────────
const DOC_REF = () => doc(db, "gymtrack", "main");

async function loadFromFirebase() {
  try {
    const snap = await getDoc(DOC_REF());
    return snap.exists() ? snap.data().payload : null;
  } catch(e) {
    console.error("Firebase load error:", e);
    return null;
  }
}

async function saveToFirebase(data) {
  try {
    await setDoc(DOC_REF(), { payload: data, updatedAt: new Date().toISOString() });
  } catch(e) {
    console.error("Firebase save error:", e);
  }
}

// ─── CSV EXPORT ───────────────────────────────────────────────────────────
function exportCSV(cycles, studentName, teacherName) {
  const rows=[["Ciclo","Nombre","Estudiante","Profesor","#Seq","Fecha","Hora","Estado","Modalidad","Notas/Motivo","Pago","Monto"]];
  cycles.forEach((cy,ci)=>{
    const seqs = buildSeqNums(cy.classes, cy.config.classesPerCycle);
    cy.classes.forEach((cls,i)=>{
      rows.push([ci+1,cy.name,studentName,teacherName,seqs[i]??"↺",cls.date,cls.time,cls.status,cls.type,cls.notes||"",cy.paid?"Pagado":"Pendiente",cy.amount]);
    });
  });
  const csv=rows.map(r=>r.map(v=>`"${v}"`).join(",")).join("\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=`entrenamiento_${studentName.replace(/\s+/g,"_")}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── DEFAULT CONFIG ────────────────────────────────────────────────────────
const DEFAULT_CONFIG = { classesPerCycle:12, weekDays:[2,4,6], amount:660000 };

function initDefaultData() {
  const config = {...DEFAULT_CONFIG};
  const s1=nextValidDay(isoToday(),config.weekDays);
  const c1=buildCycle(s1,config,0);
  const s2=nextValidDay(addDays(c1.endDate,1),config.weekDays);
  const c2=buildCycle(s2,config,1);
  const s3=nextValidDay(addDays(c2.endDate,1),config.weekDays);
  const c3=buildCycle(s3,config,2);
  return {teacherName:"Yony Vega",studentName:"Juan Sebastian",cycles:[c1,c2,c3],globalConfig:{...config}};
}

// ─── BADGE ────────────────────────────────────────────────────────────────
function Badge({children,color}) {
  const map={
    green: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    red:   "bg-rose-500/20 text-rose-300 border-rose-500/30",
    orange:"bg-orange-500/20 text-orange-300 border-orange-500/30",
    yellow:"bg-amber-500/20 text-amber-300 border-amber-500/30",
    blue:  "bg-sky-500/20 text-sky-300 border-sky-500/30",
    purple:"bg-violet-500/20 text-violet-300 border-violet-500/30",
    gray:  "bg-zinc-700/60 text-zinc-400 border-zinc-600/30",
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${map[color]||map.gray}`}>{children}</span>;
}

// ─── TIME SELECTOR ────────────────────────────────────────────────────────
// Shows 3 editable time pills. One is highlighted green (the "agreed" time).
// The user can:
//   • Click any pill label to select it as the agreed time (highlights green)
//   • Click the pencil on any pill to edit that pill's hour value
//   • The agreed time is always the currently selected (green) pill
//
// Props:
//   date      — ISO date string used to determine default time slot options
//   value     — the currently agreed time ("HH:MM")
//   options   — array of 3 time strings being shown (each editable)
//   onChange  — called with (newAgreedTime, newOptionsArray) on any change
function TimeSelector({ date, value, options, onChange }) {
  // which pill index is being edited inline
  const [editingIdx, setEditingIdx] = useState(null);

  function selectAgreed(t) {
    onChange(t, options);
  }

  function editPill(idx, newTime) {
    const newOpts = [...options];
    newOpts[idx] = newTime;
    // if the edited pill was the agreed time, update agreed too
    const newAgreed = options[idx] === value ? newTime : value;
    onChange(newAgreed, newOpts);
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] text-zinc-500 mb-1">Toca la hora para seleccionarla como acordada · ✏️ para editarla</div>
      <div className="flex gap-2 flex-wrap">
        {options.map((t, idx) => {
          const isAgreed = t === value;
          return (
            <div key={idx} className={`flex items-center rounded-xl border transition-all
              ${isAgreed
                ? "bg-emerald-600/90 border-emerald-400/60 shadow-lg shadow-emerald-900/30"
                : "bg-zinc-800 border-zinc-600"}`}>
              {editingIdx === idx ? (
                <input
                  type="time"
                  value={t}
                  autoFocus
                  onChange={e => editPill(idx, e.target.value)}
                  onBlur={() => setEditingIdx(null)}
                  className="w-24 bg-transparent text-xs font-semibold px-2 py-1.5 outline-none text-zinc-100"
                />
              ) : (
                <button
                  onClick={() => selectAgreed(t)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-l-xl transition-colors
                    ${isAgreed ? "text-white" : "text-zinc-400 hover:text-zinc-200"}`}>
                  {fmt12(t)}
                  {isAgreed && <span className="ml-1 text-[9px] text-emerald-200/70">acordada</span>}
                </button>
              )}
              <button
                onClick={() => setEditingIdx(editingIdx === idx ? null : idx)}
                className={`text-[10px] px-1.5 py-1.5 rounded-r-xl border-l transition-colors
                  ${isAgreed
                    ? "border-emerald-400/30 text-emerald-200/60 hover:text-white"
                    : "border-zinc-700 text-zinc-600 hover:text-zinc-300"}`}
                title="Editar hora">
                ✏️
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MODALS ───────────────────────────────────────────────────────────────
const CANCEL_REASONS   =["Enfermedad estudiante","Enfermedad profesor","Día feriado","Vacaciones","Emergencia personal","Viaje","Clima","Otro motivo"];
const RESCHEDULE_REASONS=["Mutuo acuerdo","Conflicto de horario","Evento especial","Cambio de plan","Viaje","Otro motivo"];

function ReasonModal({title,subtitle,accentColor,reasons,onConfirm,onClose}) {
  const [reason,setReason]=useState("");
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`bg-zinc-900 border rounded-2xl p-5 w-full max-w-sm shadow-2xl border-${accentColor}-700/40`}>
        <h3 className={`text-base font-bold text-${accentColor}-300 mb-1`}>{title}</h3>
        <p className="text-xs text-zinc-400 mb-3" dangerouslySetInnerHTML={{__html:subtitle}} />
        <div className="flex flex-wrap gap-1.5 mb-3">
          {reasons.map(r=>(
            <button key={r} onClick={()=>setReason(r)}
              className={`text-xs px-2 py-1 rounded-lg border transition-colors
                ${reason===r?`bg-${accentColor}-700/60 border-${accentColor}-500/50 text-${accentColor}-200`:"bg-zinc-800 border-zinc-600 text-zinc-400 hover:border-zinc-500"}`}>
              {r}
            </button>
          ))}
        </div>
        <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="O escribe el motivo..."
          className={`w-full bg-zinc-800 border border-zinc-600 rounded-xl px-3 py-2 text-sm text-zinc-200 mb-4 focus:outline-none focus:border-${accentColor}-500`} />
        <div className="flex gap-2">
          <button onClick={()=>onConfirm(reason.trim()||"Sin motivo")}
            className={`flex-1 bg-${accentColor}-700 hover:bg-${accentColor}-600 text-white py-2 rounded-xl text-sm transition-colors`}>
            Confirmar
          </button>
          <button onClick={onClose}
            className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 py-2 rounded-xl text-sm transition-colors">
            Volver
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CLASS CARD ───────────────────────────────────────────────────────────
function ClassCard({cls, seqNum, cycleConfig, onUpdate, onUpdateRecalc, onCancel, onReschedule, isPast}) {
  const [editing, setEditing]         = useState(false);
  const [showCancel, setShowCancel]   = useState(false);
  const [showResched, setShowResched] = useState(false);

  // agreed time = the one highlighted green
  const [localTime, setLocalTime]     = useState(cls.time || defaultTime(cls.date));
  // the 3 editable pill values
  const [timeOpts, setTimeOpts]       = useState(
    cls.timeOptions || defaultTimeOptions(cls.date)
  );
  const [localDate, setLocalDate]     = useState(cls.date);
  const [localType, setLocalType]     = useState(cls.type||"presencial");
  const [localNotes, setLocalNotes]   = useState(cls.notes||"");

  useEffect(()=>{
    const agreed = cls.time || defaultTime(cls.date);
    const opts   = cls.timeOptions || defaultTimeOptions(cls.date);
    setLocalTime(agreed);
    setTimeOpts(opts);
    setLocalDate(cls.date);
    setLocalType(cls.type||"presencial");
    setLocalNotes(cls.notes||"");
  },[cls.id, cls.date, cls.time]);

  const dateObj    = parseLocal(cls.date);
  const dayName    = DAYS_ES[dateObj.getDay()];
  const isToday    = isoToday()===cls.date;
  const isDone     = cls.status==="done";
  const isCancelled= cls.status==="cancelled";
  const isReschd   = cls.status==="rescheduled";
  const isPending  = cls.status==="pending";

  function save() {
    const dateChanged = localDate !== cls.date;
    // if date changed, rebuild time options for new date but keep agreed if still valid
    const newOpts = dateChanged ? defaultTimeOptions(localDate) : timeOpts;
    const newTime = dateChanged ? defaultTime(localDate) : localTime;
    const updated = {
      ...cls,
      time: newTime,
      timeOptions: newOpts,
      notes: localNotes,
      type: localType,
      date: localDate,
    };
    if (dateChanged) onUpdateRecalc(updated); else onUpdate(updated);
    setEditing(false);
  }

  function handleTimeChange(newAgreed, newOpts) {
    setLocalTime(newAgreed);
    setTimeOpts(newOpts);
  }

  // Visual styles per status
  let cardBorder, numBg, numText;
  if (isDone)      { cardBorder="border-emerald-500/30 bg-emerald-950/20"; numBg="bg-emerald-500/30"; numText="text-emerald-300"; }
  else if(isCancelled){ cardBorder="border-rose-500/25 bg-rose-950/10";    numBg="bg-rose-500/20";    numText="text-rose-400"; }
  else if(isReschd){ cardBorder="border-orange-500/25 bg-orange-950/10";   numBg="bg-orange-500/20";  numText="text-orange-300"; }
  else if(isToday) { cardBorder="border-sky-400/40 bg-sky-950/20 shadow-lg shadow-sky-900/10"; numBg="bg-sky-500/30"; numText="text-sky-300"; }
  else             { cardBorder="border-zinc-700/50 bg-zinc-800/40";        numBg="bg-zinc-700";       numText="text-zinc-300"; }

  let statusBadge;
  if (isDone)          statusBadge=<Badge color="green">✓ Realizada</Badge>;
  else if(isCancelled) statusBadge=<Badge color="red">✗ Cancelada</Badge>;
  else if(isReschd)    statusBadge=<Badge color="orange">↺ Reprogramada</Badge>;
  else if(isToday)     statusBadge=<Badge color="blue">● Hoy</Badge>;
  else                 statusBadge=<Badge color="gray">Pendiente</Badge>;

  // Read-only time display: show all 3 pills, agreed one in green
  const displayOpts = cls.timeOptions || defaultTimeOptions(cls.date);
  const agreedTime  = cls.time || defaultTime(cls.date);

  return (
    <>
      <div className={`rounded-xl border transition-all duration-200 ${cardBorder}
        ${isPast&&!isDone&&!isCancelled&&!isReschd?"opacity-55":""}`}>

        <div className="flex items-start gap-3 p-3">
          {/* Sequence / status bubble */}
          <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${numBg} ${numText}`}>
            {isReschd ? "↺" : (seqNum??"-")}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span className={`text-sm font-semibold ${isCancelled||isReschd?"text-zinc-500":"text-zinc-200"}`}>
                {dayName} {formatDate(cls.date)}
              </span>
              {statusBadge}
              {!isCancelled && !isReschd && (
                <Badge color={cls.type==="virtual"?"purple":"blue"}>
                  {cls.type==="virtual"?"🖥 Virtual":"🏋 Presencial"}
                </Badge>
              )}
              {cls.isMakeup && <Badge color="yellow">⚡ Reposición</Badge>}
            </div>

            {/* Time pills read-only */}
            {!isCancelled && !isReschd && !editing && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {displayOpts.map((t, i) => {
                  const isA = t === agreedTime;
                  return (
                    <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold border
                      ${isA
                        ? "bg-emerald-600/80 border-emerald-400/50 text-white"
                        : "bg-zinc-800/60 border-zinc-700 text-zinc-500"}`}>
                      {fmt12(t)}
                      {isA && <span className="text-[9px] text-emerald-200/60 font-normal">acordada</span>}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Reason / notes */}
            {cls.notes && (isCancelled||isReschd) && (
              <div className={`text-xs mt-1 ${isCancelled?"text-rose-400":"text-orange-400"}`}>
                {isCancelled?"🚫":"↺"} {cls.notes}
              </div>
            )}
            {cls.notes && isPending && (
              <div className="text-xs mt-1 text-zinc-500">📝 {cls.notes}</div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {isPending && <>
              <button onClick={()=>onUpdate({...cls,status:"done"})}
                className="text-xs px-2 py-1 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white transition-colors" title="Realizada">✓</button>
              <button onClick={()=>setShowCancel(true)}
                className="text-xs px-2 py-1 rounded-lg bg-rose-900/60 hover:bg-rose-800 text-rose-300 border border-rose-700/30 transition-colors" title="Cancelar">✗</button>
              <button onClick={()=>setShowResched(true)}
                className="text-xs px-2 py-1 rounded-lg bg-orange-900/50 hover:bg-orange-800/70 text-orange-300 border border-orange-700/30 transition-colors" title="Reprogramar">↺</button>
              <button onClick={()=>setEditing(!editing)}
                className="text-xs px-2 py-1 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors" title="Editar">✏️</button>
            </>}
            {isDone && (
              <button onClick={()=>onUpdate({...cls,status:"pending"})}
                className="text-xs px-2 py-1 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors" title="Deshacer">↩</button>
            )}
            {(isCancelled||isReschd) && (
              <button onClick={()=>onUpdate({...cls,status:"pending",notes:"",cancelledAt:undefined,rescheduledAt:undefined})}
                className="text-xs px-2 py-1 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors" title="Restaurar">↩</button>
            )}
          </div>
        </div>

        {/* Edit panel */}
        {editing && (
          <div className="border-t border-zinc-700/50 p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Fecha</label>
                <input type="date" value={localDate} onChange={e=>setLocalDate(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-sky-500" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Modalidad</label>
                <select value={localType} onChange={e=>setLocalType(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-sky-500">
                  <option value="presencial">🏋 Presencial</option>
                  <option value="virtual">🖥 Virtual</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Horas propuestas · hora acordada iluminada</label>
              <TimeSelector
                date={localDate}
                value={localTime}
                options={timeOpts}
                onChange={handleTimeChange}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Notas</label>
              <input value={localNotes} onChange={e=>setLocalNotes(e.target.value)} placeholder="observaciones..."
                className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-sky-500" />
            </div>
            <div className="flex gap-2">
              <button onClick={save}
                className="flex-1 bg-sky-600 hover:bg-sky-500 text-white text-sm py-1.5 rounded-lg transition-colors">Guardar</button>
              <button onClick={()=>setEditing(false)}
                className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm py-1.5 rounded-lg transition-colors">Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {/* Cancel modal */}
      {showCancel && (
        <ReasonModal
          title="Cancelar Clase"
          subtitle="La clase queda en el historial y <strong class='text-zinc-200'>sí contabiliza</strong> como clase del ciclo (no se agrega reposición)."
          accentColor="rose"
          reasons={CANCEL_REASONS}
          onConfirm={r=>{onCancel({...cls,status:"cancelled",notes:r,cancelledAt:isoToday()});setShowCancel(false);}}
          onClose={()=>setShowCancel(false)} />
      )}

      {/* Reschedule modal */}
      {showResched && (
        <ReasonModal
          title="Reprogramar Clase"
          subtitle="Por mutuo acuerdo. La clase queda en el historial pero <strong class='text-zinc-200'>NO cuenta</strong> como slot — se agrega una clase de reposición al final del ciclo."
          accentColor="orange"
          reasons={RESCHEDULE_REASONS}
          onConfirm={r=>{onReschedule({...cls,status:"rescheduled",notes:r,rescheduledAt:isoToday()});setShowResched(false);}}
          onClose={()=>setShowResched(false)} />
      )}
    </>
  );
}

// ─── CYCLE CARD ───────────────────────────────────────────────────────────
function CycleCard({cycle, cycleIndex, isCurrent, onUpdateCycle, onUpdateClass, onUpdateClassRecalc, onCancelClass, onRescheduleClass, onResetCycle}) {
  const target    = cycle.config.classesPerCycle;
  const done      = doneCount(cycle.classes);
  const cancelled = cancelledCount(cycle.classes);
  const reschd    = rescheduledCount(cycle.classes);
  // Remaining = target - done - cancelled  (both "consume" a slot)
  const remaining = Math.max(0, target - done - cancelled);
  const pct_done  = Math.round((done/target)*100);
  const pct_canc  = Math.round((cancelled/target)*100);

  const seqNums = buildSeqNums(cycle.classes, target);

  const [editingConfig, setEditingConfig] = useState(false);
  const [localConfig, setLocalConfig]     = useState({...cycle.config});
  const [showAll, setShowAll]             = useState(isCurrent);
  const [confirmReset, setConfirmReset]   = useState(false);

  const DAY_OPTIONS=[{v:1,l:"Lun"},{v:2,l:"Mar"},{v:3,l:"Mié"},{v:4,l:"Jue"},{v:5,l:"Vie"},{v:6,l:"Sáb"},{v:0,l:"Dom"}];

  function saveConfig() { onUpdateCycle({...cycle,config:{...localConfig}}); setEditingConfig(false); }

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all
      ${isCurrent?"border-sky-500/40 shadow-xl shadow-sky-900/10":"border-zinc-700/40"}
      bg-zinc-900/60 backdrop-blur-sm`}>

      {/* Header */}
      <div className={`p-4 ${isCurrent?"bg-gradient-to-r from-sky-950/60 to-zinc-900/60":"bg-zinc-800/40"}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {isCurrent
                ?<span className="text-xs px-2 py-0.5 rounded-full bg-sky-500 text-white font-bold">ACTUAL</span>
                :<span className="text-xs px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400">Ciclo {cycleIndex+1}</span>}
              <h3 className="text-lg font-bold text-white">{cycle.name}</h3>
            </div>
            <div className="text-xs text-zinc-400">{formatDate(cycle.startDate)} → {formatDate(cycle.endDate)}</div>
          </div>
          <button onClick={()=>onUpdateCycle({...cycle,paid:!cycle.paid})}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold border transition-all
              ${cycle.paid?"bg-emerald-600/80 border-emerald-500/50 text-white":"bg-zinc-800 border-zinc-600 text-zinc-300 hover:border-amber-500/50 hover:text-amber-300"}`}>
            {cycle.paid?"💳 Pagado":"💰 Sin Pagar"}
          </button>
        </div>

        {/* Progress */}
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-zinc-400 space-x-2">
              <span className="text-emerald-400 font-semibold">{done} realizadas</span>
              {cancelled>0 && <span className="text-rose-400">{cancelled} canceladas</span>}
              {reschd>0    && <span className="text-orange-400">{reschd} reprog.</span>}
            </span>
            <span className={remaining>0?"text-amber-400 font-semibold":"text-emerald-400 font-semibold"}>
              {remaining>0?`${remaining} pendientes`:"✓ Completado"}
            </span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full flex">
              <div className="bg-emerald-500 transition-all duration-500" style={{width:`${pct_done}%`}}/>
              <div className="bg-rose-700/70 transition-all duration-500" style={{width:`${pct_canc}%`}}/>
            </div>
          </div>
          {/* Dots: exactly `target` dots */}
          <div className="flex gap-0.5 mt-1.5">
            {Array.from({length:target}).map((_,i)=>(
              <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors
                ${i<done?"bg-emerald-500":i<done+cancelled?"bg-rose-700/60":"bg-zinc-700"}`}/>
            ))}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-zinc-500">
            ${cycle.amount?.toLocaleString("es-CO")} COP · {target} clases objetivo
            {reschd>0&&<span className="text-orange-500/70 ml-1">· +{reschd} repos.</span>}
          </span>
          <div className="flex gap-1.5">
            <button onClick={()=>setConfirmReset(true)}
              className="text-xs px-2 py-1 rounded-lg bg-amber-900/50 hover:bg-amber-800/60 text-amber-300 border border-amber-700/30 transition-colors"
              title="Reiniciar clases pendientes de este ciclo">🔄 Reiniciar</button>
            <button onClick={()=>setEditingConfig(!editingConfig)}
              className="text-xs px-2 py-1 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors">⚙️ Config</button>
            <button onClick={()=>setShowAll(!showAll)}
              className="text-xs px-2 py-1 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors">
              {showAll?"▲ Menos":"▼ Ver clases"}
            </button>
          </div>
        </div>
      </div>

      {/* ── RESET CONFIRM MODAL ── */}
      {confirmReset && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-amber-700/40 rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <div className="text-base font-bold text-amber-300 mb-1">🔄 Reiniciar Ciclo {cycleIndex+1}: {cycle.name}</div>
            <p className="text-xs text-zinc-400 mb-4">
              Se regenerarán las <strong className="text-zinc-200">clases pendientes</strong> de este ciclo
              con fechas desde hoy en adelante.<br/><br/>
              Las clases ya <strong className="text-emerald-400">realizadas ✓</strong>,{" "}
              <strong className="text-rose-400">canceladas ✗</strong> y{" "}
              <strong className="text-orange-400">reprogramadas ↺</strong> se conservan intactas.
            </p>
            <div className="flex gap-2">
              <button onClick={()=>{onResetCycle();setConfirmReset(false);}}
                className="flex-1 bg-amber-700 hover:bg-amber-600 text-white py-2 rounded-xl text-sm transition-colors font-semibold">
                Sí, reiniciar pendientes
              </button>
              <button onClick={()=>setConfirmReset(false)}
                className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 py-2 rounded-xl text-sm transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config */}
      {editingConfig && (
        <div className="border-t border-zinc-700/50 p-4 bg-zinc-800/40">
          <h4 className="text-sm font-semibold text-zinc-300 mb-3">Configuración del Ciclo</h4>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Clases por ciclo</label>
              <input type="number" min="1" max="30" value={localConfig.classesPerCycle}
                onChange={e=>setLocalConfig({...localConfig,classesPerCycle:+e.target.value})}
                className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-sky-500"/>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Monto (COP)</label>
              <input type="number" value={localConfig.amount}
                onChange={e=>setLocalConfig({...localConfig,amount:+e.target.value})}
                className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-sky-500"/>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-zinc-400 mb-1 block">Días de la semana</label>
              <div className="flex flex-wrap gap-1">
                {DAY_OPTIONS.map(d=>(
                  <button key={d.v} onClick={()=>{
                    const days=localConfig.weekDays.includes(d.v)
                      ?localConfig.weekDays.filter(x=>x!==d.v)
                      :[...localConfig.weekDays,d.v].sort();
                    setLocalConfig({...localConfig,weekDays:days});
                  }}
                    className={`text-xs px-2 py-1 rounded-lg border transition-colors
                      ${localConfig.weekDays.includes(d.v)?"bg-sky-600 border-sky-500 text-white":"bg-zinc-800 border-zinc-600 text-zinc-400"}`}>
                    {d.l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveConfig} className="flex-1 bg-sky-600 hover:bg-sky-500 text-white text-sm py-1.5 rounded-lg transition-colors">Aplicar</button>
            <button onClick={()=>setEditingConfig(false)} className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm py-1.5 rounded-lg transition-colors">Cancelar</button>
          </div>
        </div>
      )}

      {/* Classes */}
      {showAll && (
        <div className="border-t border-zinc-700/50 p-4 space-y-2">
          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500 pb-2 border-b border-zinc-800/60">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"/>Realizada → cuenta slot</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-600 inline-block"/>Cancelada → cuenta slot (sin reposición)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block"/>Reprogramada → NO cuenta (+ reposición ⚡)</span>
          </div>
          {cycle.classes.map((cls,i)=>(
            <ClassCard key={cls.id}
              cls={cls}
              seqNum={seqNums[i]}
              cycleConfig={cycle.config}
              isPast={cls.date<isoToday()}
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

// ─── APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [data,setData]       = useState(null);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving]   = useState(false);
  const [lastSaved,setLastSaved] = useState(null);
  const [editNames,setEditNames] = useState(false);
  const [lStudent,setLStudent]   = useState("");
  const [lTeacher,setLTeacher]   = useState("");
  const [tab,setTab]             = useState("cycles");
  const isFirstLoad              = useRef(true);

  // Real-time Firestore listener — both users see changes instantly
  useEffect(()=>{
    const unsub = onSnapshot(DOC_REF(), snap=>{
      if(snap.exists()){
        setData(snap.data().payload);
        setLastSaved(snap.data().updatedAt);
      } else if(isFirstLoad.current){
        const init = initDefaultData();
        setData(init);
        saveToFirebase(init);
      }
      setLoading(false);
      isFirstLoad.current = false;
    }, err=>{
      console.error("Snapshot error:", err);
      setData(d => d || initDefaultData());
      setLoading(false);
    });
    return () => unsub();
  },[]);

  // persist: update UI instantly, save to Firestore in background
  const persist = useCallback((nd) => {
    setData(nd);
    setSaving(true);
    saveToFirebase(nd).then(() => {
      setSaving(false);
      setLastSaved(new Date().toISOString());
    });
  }, []);

  function updateCycle(idx,upd){const c=[...data.cycles];c[idx]=upd;persist({...data,cycles:c});}

  function updateClass(ci,li,upd){
    const cycles=[...data.cycles];const cls=[...cycles[ci].classes];cls[li]=upd;
    cycles[ci]={...cycles[ci],classes:cls};persist({...data,cycles});
  }

  function updateClassRecalc(ci,li,upd){
    const cycles=[...data.cycles];let cls=[...cycles[ci].classes];cls[li]=upd;
    cls=recalcForward(cls,li,cycles[ci].config);
    cycles[ci]={...cycles[ci],classes:cls,endDate:cls[cls.length-1]?.date,name:cycleName(cls)};
    persist({...data,cycles});
  }

  // CANCEL → slot consumed, no makeup
  function cancelClass(ci,li,cancelled){
    const cycles=[...data.cycles];const cls=[...cycles[ci].classes];
    cls[li]=cancelled;cycles[ci]={...cycles[ci],classes:cls};persist({...data,cycles});
  }

  // RESCHEDULE → slot freed → add makeup
  function rescheduleClass(ci,li,reschd){
    const cycles=[...data.cycles];const cycle=cycles[ci];
    let cls=[...cycle.classes];cls[li]=reschd;
    cls.push(makeMakeup(cls,cycle.config));
    cycles[ci]={...cycle,classes:cls,endDate:cls[cls.length-1].date,name:cycleName(cls)};
    persist({...data,cycles});
  }

  // Reset a single cycle: keeps done/cancelled classes, regenerates only pending ones
  // from the first pending date forward (or from cycle.startDate if all done)
  function resetCycle(cycleIdx) {
    const cycles = [...data.cycles];
    const cycle  = cycles[cycleIdx];
    const config = cycle.config;

    // Separate classes that are already settled (done / cancelled / rescheduled)
    // from those still pending
    const settled = cycle.classes.filter(c => c.status !== "pending");

    // Find the start date for fresh pending classes:
    // → day after the last settled class date, or cycle.startDate if none
    const lastSettledDate = settled.reduce((mx,c)=>c.date>mx?c.date:mx, "");
    const freshStart = lastSettledDate
      ? nextValidDay(addDays(lastSettledDate, 1), config.weekDays)
      : nextValidDay(cycle.startDate, config.weekDays);

    // How many pending slots do we still need?
    const slotsFilled = settled.filter(c => c.status !== "rescheduled").length;
    const slotsNeeded = Math.max(0, config.classesPerCycle - slotsFilled);

    // Generate fresh pending classes
    const freshClasses = [];
    let cursor = freshStart;
    while (freshClasses.length < slotsNeeded) {
      if (config.weekDays.includes(dow(cursor))) {
        freshClasses.push({
          id: `cls-${Date.now()}-${freshClasses.length}-${Math.random().toString(36).slice(2,5)}`,
          date: cursor,
          time: defaultTime(cursor),
          status: "pending",
          type: "presencial",
          notes: "",
        });
      }
      cursor = addDays(cursor, 1);
    }

    const newClasses = [...settled, ...freshClasses]
      .sort((a,b) => a.date.localeCompare(b.date));

    cycles[cycleIdx] = {
      ...cycle,
      classes: newClasses,
      startDate: newClasses[0]?.date,
      endDate:   newClasses[newClasses.length-1]?.date,
      name: cycleName(newClasses),
    };
    persist({...data, cycles});
  }

  function addNextCycle(){
    const last=data.cycles[data.cycles.length-1]; if(!last)return;
    const config=last.config||data.globalConfig||DEFAULT_CONFIG;
    persist({...data,cycles:[...data.cycles,buildCycle(nextValidDay(addDays(last.endDate,1),config.weekDays),config,Date.now())]});
  }

  if(loading) return(
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <div className="text-zinc-400 text-sm animate-pulse mb-1">Conectando con Firebase...</div>
        <div className="text-zinc-600 text-xs">GymTrack · Yony × Juan</div>
      </div>
    </div>
  );

  const currentIdx=data.cycles.findIndex(c=>(doneCount(c.classes)+cancelledCount(c.classes))<c.config.classesPerCycle);
  const displayIdx=currentIdx===-1?data.cycles.length-1:currentIdx;
  const curCycle=data.cycles[displayIdx];
  const totalDone=data.cycles.reduce((s,c)=>s+doneCount(c.classes),0);
  const totalTarget=data.cycles.reduce((s,c)=>s+c.config.classesPerCycle,0);
  const remaining=curCycle?Math.max(0,curCycle.config.classesPerCycle-doneCount(curCycle.classes)-cancelledCount(curCycle.classes)):0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{fontFamily:"'DM Sans',system-ui,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#18181b}::-webkit-scrollbar-thumb{background:#3f3f46;border-radius:2px}
      `}</style>

      {/* Topbar */}
      <div className="sticky top-0 z-50 bg-zinc-950/90 backdrop-blur border-b border-zinc-800/60">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-500 to-violet-600 flex items-center justify-center text-sm font-bold">G</div>
            <div>
              <div className="text-sm font-bold leading-none">GymTrack</div>
              <div className="text-xs text-zinc-500 leading-none mt-0.5">{data.teacherName} × {data.studentName}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {saving
              ? <span className="text-xs text-sky-400 animate-pulse mr-1">💾 Guardando...</span>
              : lastSaved && <span className="text-xs text-zinc-600 mr-1">✓ Guardado</span>
            }
            <button onClick={()=>{setLStudent(data.studentName);setLTeacher(data.teacherName);setEditNames(true);}}
              className="text-xs px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors">✏️ Nombres</button>
            <button onClick={()=>exportCSV(data.cycles,data.studentName,data.teacherName)}
              className="text-xs px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors">⬇️ Excel</button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Names modal */}
        {editNames&&(
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-full max-w-sm">
              <h3 className="text-base font-bold mb-4">Editar Nombres</h3>
              <div className="space-y-3 mb-4">
                <div><label className="text-xs text-zinc-400 mb-1 block">Profesor</label>
                  <input value={lTeacher} onChange={e=>setLTeacher(e.target.value)} className="w-full bg-zinc-800 border border-zinc-600 rounded-xl px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-sky-500"/></div>
                <div><label className="text-xs text-zinc-400 mb-1 block">Estudiante</label>
                  <input value={lStudent} onChange={e=>setLStudent(e.target.value)} className="w-full bg-zinc-800 border border-zinc-600 rounded-xl px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-sky-500"/></div>
              </div>
              <div className="flex gap-2">
                <button onClick={()=>{persist({...data,studentName:lStudent,teacherName:lTeacher});setEditNames(false);}} className="flex-1 bg-sky-600 hover:bg-sky-500 text-white py-2 rounded-xl text-sm transition-colors">Guardar</button>
                <button onClick={()=>setEditNames(false)} className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 py-2 rounded-xl text-sm transition-colors">Cancelar</button>
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            {label:"Realizadas",value:totalDone,sub:`de ${totalTarget}`,c:"text-emerald-400"},
            {label:"Pendientes",value:remaining,sub:"ciclo actual",c:"text-amber-400"},
            {label:"Ciclos",value:data.cycles.length,sub:"programados",c:"text-sky-400"},
            {label:curCycle?.name||"-",value:curCycle?.paid?"✓":"$",sub:curCycle?.paid?"Pagado":"Sin pagar",c:curCycle?.paid?"text-emerald-400":"text-rose-400"},
          ].map((s,i)=>(
            <div key={i} className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-3 text-center">
              <div className={`text-xl font-bold leading-none ${s.c}`}>{s.value}</div>
              <div className="text-xs text-zinc-500 mt-1 leading-tight">{s.label}</div>
              <div className="text-xs text-zinc-600 mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-zinc-900 rounded-xl p-1">
          {[{id:"cycles",label:"📅 Ciclos"},{id:"history",label:"📊 Historial"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab===t.id?"bg-zinc-700 text-white":"text-zinc-500 hover:text-zinc-300"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab==="cycles"&&(
          <div className="space-y-4">
            {data.cycles.map((cycle,idx)=>(
              <CycleCard key={cycle.id} cycle={cycle} cycleIndex={idx}
                isCurrent={idx===displayIdx}
                onUpdateCycle={upd=>updateCycle(idx,upd)}
                onUpdateClass={updateClass}
                onUpdateClassRecalc={updateClassRecalc}
                onCancelClass={cancelClass}
                onRescheduleClass={rescheduleClass}
                onResetCycle={()=>resetCycle(idx)}/>
            ))}
            <button onClick={addNextCycle}
              className="w-full py-3 rounded-2xl border-2 border-dashed border-zinc-700 hover:border-sky-500/50 text-zinc-500 hover:text-sky-400 text-sm transition-all">
              + Agregar ciclo siguiente
            </button>
          </div>
        )}

        {tab==="history"&&(
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-zinc-400">Historial completo</h3>
            {data.cycles.map((cycle,ci)=>{
              const done=doneCount(cycle.classes);
              const canc=cancelledCount(cycle.classes);
              const rsc=rescheduledCount(cycle.classes);
              const virt=cycle.classes.filter(c=>c.type==="virtual"&&c.status==="done").length;
              return(
                <div key={cycle.id} className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-zinc-200">Ciclo {ci+1}: {cycle.name}</span>
                    <Badge color={cycle.paid?"green":"yellow"}>{cycle.paid?"Pagado":"Pendiente"}</Badge>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 text-center">
                    {[
                      {v:done,l:"Realizadas",c:"text-emerald-400"},
                      {v:canc,l:"Canceladas",c:"text-rose-400"},
                      {v:rsc, l:"Reprog.",   c:"text-orange-400"},
                      {v:virt,l:"Virtuales", c:"text-violet-400"},
                      {v:`$${(cycle.amount||0).toLocaleString("es-CO")}`,l:"COP",c:"text-sky-400"},
                    ].map((s,i)=>(
                      <div key={i} className="bg-zinc-800/60 rounded-lg p-2">
                        <div className={`text-base font-bold ${s.c} ${i===4?"text-xs":""}`}>{s.v}</div>
                        <div className="text-xs text-zinc-500">{s.l}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-zinc-600">{formatDate(cycle.startDate)} → {formatDate(cycle.endDate)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
