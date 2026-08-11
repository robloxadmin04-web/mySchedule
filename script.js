/* =========================================================
   COURSEWORK — application logic
   ========================================================= */

(function(){
"use strict";

/* ---------------------------------------------------------
   CONSTANTS
--------------------------------------------------------- */
const STORAGE_KEY = "coursework.state.v1";
const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const CLASS_TYPES_DEFAULT = ["Zoom","Face to Face","Online","Other"];
const CATEGORY_TYPES_DEFAULT = ["Quiz","Assignment","Activity","Exam","Project","Attendance","Other"];
const FILE_CATEGORIES = ["Modules","Assignments","References","School Links","Other"];

const WIDGET_LABELS = {
  nextclass:"Next Class", progress:"Weekly Progress", todayschedule:"Today's Schedule",
  todaytasks:"Today's Tasks", deadlines:"Upcoming Deadlines", focusstats:"Focus Statistics",
  quickactions:"Quick Actions"
};

/* ---------------------------------------------------------
   STATE
--------------------------------------------------------- */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function defaultState(){
  return {
    setupDone:false,
    profile:{ name:"Student", studentId:"", program:"My Program", year:"", section:"", school:"My College", email:"" },
    settings:{
      weekStart:"mon", timeFormat:"24", classDuration:60, defaultClassType:"Face to Face",
      defaultPriority:"Medium", defaultStatus:"Not Started", taskSort:"due",
      passing:75, target:90, decimals:2,
      focusDur:25, shortDur:5, longDur:15, sessionsBeforeLong:4,
      theme:"light", density:"comfortable", radius:"soft", reduceMotion:false,
      classTypes: CLASS_TYPES_DEFAULT.slice(),
      widgets:{ nextclass:true, progress:true, todayschedule:true, todaytasks:true, deadlines:true, focusstats:true, quickactions:true }
    },
    classes:[],
    tasks:[],
    subjects:[],
    grades:{},
    notes:[],
    files:[],
    focusStats:{ sessionsCompleted:0, totalFocusMinutes:0, history:[] }
  };
}

let state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // merge with defaults to survive schema growth
    const def = defaultState();
    return deepMerge(def, parsed);
  }catch(e){
    console.error("Failed to load state", e);
    return defaultState();
  }
}

function deepMerge(base, incoming){
  if(Array.isArray(base)) return incoming !== undefined ? incoming : base;
  if(typeof base === "object" && base !== null){
    const out = {...base};
    for(const k in incoming || {}){
      if(k in base && typeof base[k] === "object" && base[k] !== null && !Array.isArray(base[k])){
        out[k] = deepMerge(base[k], incoming[k]);
      } else {
        out[k] = incoming[k];
      }
    }
    return out;
  }
  return incoming !== undefined ? incoming : base;
}

function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(e){
    console.error("Failed to save state", e);
    toast("Could not save — storage may be full.");
  }
}

/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */
function $(sel, root){ return (root||document).querySelector(sel); }
function $all(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }
function el(tag, attrs, children){
  const e = document.createElement(tag);
  for(const k in attrs||{}){
    if(k === "class") e.className = attrs[k];
    else if(k === "html") e.innerHTML = attrs[k];
    else if(k.startsWith("on") && typeof attrs[k]==="function") e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  (children||[]).forEach(c=>{ if(c) e.appendChild(typeof c==="string"?document.createTextNode(c):c); });
  return e;
}
function escapeHtml(s){
  return String(s==null?"":s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}
function pad2(n){ return String(n).padStart(2,"0"); }

function fmtTime(hhmm){
  if(!hhmm) return "";
  const [h,m] = hhmm.split(":").map(Number);
  if(state.settings.timeFormat === "12"){
    const period = h>=12 ? "PM":"AM";
    let hh = h % 12; if(hh===0) hh=12;
    return `${hh}:${pad2(m)} ${period}`;
  }
  return `${pad2(h)}:${pad2(m)}`;
}

function todayName(){ return DAYS[(new Date().getDay()+6)%7]; }
function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function orderedDays(){
  if(state.settings.weekStart === "sun"){
    return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  }
  return DAYS.slice();
}
function subjectName(id){
  const s = state.subjects.find(s=>s.id===id);
  return s ? s.name : (id || "General");
}
function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(()=>t.classList.remove("show"), 2200);
}

/* ---------------------------------------------------------
   THEME / APPEARANCE
--------------------------------------------------------- */
function applyAppearance(){
  const s = state.settings;
  let theme = s.theme;
  if(theme === "system"){
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark":"light";
  }
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-density", s.density);
  document.documentElement.setAttribute("data-radius", s.radius);
  document.documentElement.setAttribute("data-motion", s.reduceMotion ? "reduce":"normal");
}

function toggleTheme(){
  const cur = document.documentElement.getAttribute("data-theme");
  state.settings.theme = cur === "dark" ? "light":"dark";
  applyAppearance();
  saveState();
}

/* ---------------------------------------------------------
   CLOCK
--------------------------------------------------------- */
function tickClock(){
  const d = new Date();
  const timeStr = state.settings.timeFormat === "12"
    ? d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit", second:"2-digit"})
    : `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const dateStr = d.toLocaleDateString([], {weekday:"long", month:"long", day:"numeric", year:"numeric"});
  const timeEl = $("#clock-time"); if(timeEl) timeEl.textContent = timeStr;
  const dateEl = $("#clock-date"); if(dateEl) dateEl.textContent = dateStr;
}

/* ---------------------------------------------------------
   NAVIGATION
--------------------------------------------------------- */
function switchView(view){
  $all(".nav-item").forEach(b=>b.classList.toggle("active", b.dataset.view===view));
  $all(".view").forEach(v=>v.classList.toggle("active", v.id === "view-"+view));
  closeSidebarMobile();
  if(view === "grades") renderGrades();
  window.scrollTo({top:0, behavior: state.settings.reduceMotion ? "auto":"smooth"});
}

function openSidebarMobile(){ $("#sidebar").classList.add("open"); $("#scrim").classList.add("show"); }
function closeSidebarMobile(){ $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("show"); }

/* ---------------------------------------------------------
   MODAL
--------------------------------------------------------- */
function openModal(title, bodyNode, opts){
  $("#modal-title").textContent = title;
  const body = $("#modal-body");
  body.innerHTML = "";
  body.appendChild(bodyNode);
  $("#modal-overlay").classList.remove("hidden");
  const firstInput = body.querySelector("input,select,textarea");
  if(firstInput) setTimeout(()=>firstInput.focus(), 30);
}
function closeModal(){
  $("#modal-overlay").classList.add("hidden");
  $("#modal-body").innerHTML = "";
}
function confirmModal(message, onConfirm){
  const wrap = el("div", {}, [
    el("p", {}, [message]),
    el("div", {class:"modal-actions"}, [
      el("button", {class:"btn btn-ghost", onclick:closeModal}, ["Cancel"]),
      el("div", {class:"modal-actions-right"}, [
        el("button", {class:"btn btn-danger", onclick:()=>{ onConfirm(); closeModal(); }}, ["Delete"])
      ])
    ])
  ]);
  openModal("Confirm", wrap);
}

/* ---------------------------------------------------------
   FORM FIELD BUILDERS
--------------------------------------------------------- */
function field(labelText, inputNode){
  return el("div", {class:"form-row"}, [ el("label",{},[labelText]), inputNode ]);
}
function input(type, value, placeholder){
  const i = el("input", {type, placeholder: placeholder||""});
  if(value!=null) i.value = value;
  return i;
}
function textarea(value, placeholder){
  const t = el("textarea", {placeholder: placeholder||""});
  t.value = value||"";
  return t;
}
function select(options, value){
  const s = el("select", {});
  options.forEach(o=>{
    const opt = typeof o === "string" ? {value:o,label:o} : o;
    const e = el("option", {value:opt.value}, [opt.label]);
    if(opt.value === value) e.selected = true;
    s.appendChild(e);
  });
  return s;
}
function subjectSelectOptions(){
  return [{value:"", label:"— No subject —"}, ...state.subjects.map(s=>({value:s.id, label:s.name}))];
}

/* =========================================================
   CLASSES / SCHEDULE
========================================================= */
function openClassModal(existing){
  const c = existing || { id:uid(), subject:"", day: todayName(), start:"08:00", end:"09:00", location:"", type: state.settings.defaultClassType, instructor:"", room:"", notes:"" };

  const fSubject = select(subjectSelectOptions(), c.subject);
  const fSubjectFree = input("text", c.subject && !state.subjects.find(s=>s.id===c.subject) ? c.subject : "", "Or type a subject name");
  const fDay = select(DAYS, c.day);
  const fStart = input("time", c.start);
  const fEnd = input("time", c.end);
  const fLoc = input("text", c.location, "e.g. Room 204 / Google Meet");
  const fType = select(state.settings.classTypes, c.type);
  const fInstructor = input("text", c.instructor, "Instructor name");
  const fRoom = input("text", c.room, "Room / building");
  const fNotes = textarea(c.notes, "Optional notes");

  const body = el("div", {}, [
    field("Subject", fSubject),
    field("Or new subject name (optional)", fSubjectFree),
    el("div",{class:"form-grid"}, [ field("Day", fDay), field("Class type", fType) ]),
    el("div",{class:"form-grid"}, [ field("Start time", fStart), field("End time", fEnd) ]),
    field("Location", fLoc),
    el("div",{class:"form-grid"}, [ field("Instructor", fInstructor), field("Room", fRoom) ]),
    field("Notes", fNotes),
    el("div", {class:"modal-actions"}, [
      existing ? el("button", {class:"btn btn-danger", onclick:()=>{ confirmModal("Delete this class?", ()=>{ deleteClass(c.id); }); }}, ["Delete"]) : el("span",{},[]),
      el("div", {class:"modal-actions-right"}, [
        el("button", {class:"btn btn-ghost", onclick:closeModal}, ["Cancel"]),
        el("button", {class:"btn btn-primary", onclick:()=>{
          let subjectId = fSubject.value;
          const freeName = fSubjectFree.value.trim();
          if(freeName){
            let existingSubj = state.subjects.find(s=>s.name.toLowerCase()===freeName.toLowerCase());
            if(!existingSubj){
              existingSubj = { id:uid(), name:freeName, code:"", instructor:fInstructor.value, room:fRoom.value, schedule:"", description:"", notes:"", priority:"Medium" };
              state.subjects.push(existingSubj);
            }
            subjectId = existingSubj.id;
          }
          if(!subjectId){ toast("Please choose or add a subject."); return; }
          if(!fStart.value || !fEnd.value){ toast("Please set a start and end time."); return; }
          c.subject = subjectId; c.day = fDay.value; c.start = fStart.value; c.end = fEnd.value;
          c.location = fLoc.value.trim(); c.type = fType.value; c.instructor = fInstructor.value.trim();
          c.room = fRoom.value.trim(); c.notes = fNotes.value.trim();
          upsertClass(c);
          closeModal();
        }}, [existing ? "Save Changes" : "Add Class"])
      ])
    ])
  ]);

  openModal(existing ? "Edit Class" : "Add Class", body);
}
function upsertClass(c){
  const idx = state.classes.findIndex(x=>x.id===c.id);
  if(idx>=0) state.classes[idx]=c; else state.classes.push(c);
  saveState(); renderAll(); toast("Class saved.");
}
function deleteClass(id){
  state.classes = state.classes.filter(c=>c.id!==id);
  saveState(); renderAll(); toast("Class deleted.");
}
function duplicateClass(id){
  const c = state.classes.find(x=>x.id===id);
  if(!c) return;
  const copy = {...c, id:uid()};
  state.classes.push(copy);
  saveState(); renderAll(); toast("Class duplicated.");
}

function renderSchedule(){
  const grid = $("#week-grid");
  grid.innerHTML = "";
  orderedDays().forEach(day=>{
    const dayClasses = state.classes.filter(c=>c.day===day).sort((a,b)=>a.start.localeCompare(b.start));
    const col = el("div", {class:"day-col"});
    col.appendChild(el("div", {class:"day-col-head"}, [ el("h4",{},[day]), el("span",{class:"badge"},[String(dayClasses.length)]) ]));
    const body = el("div", {class:"day-col-body"});
    if(dayClasses.length===0){
      body.appendChild(el("div",{class:"empty-state"},[ el("p",{},["No classes"]) ]));
    } else {
      dayClasses.forEach(c=>{
        const chip = el("div", {class:"class-chip", onclick:()=>openClassModal(c)}, [
          el("div", {class:"cc-subject"}, [subjectName(c.subject)]),
          el("div", {class:"cc-meta"}, [`${fmtTime(c.start)}–${fmtTime(c.end)} · ${c.type}${c.location? " · "+c.location:""}`])
        ]);
        body.appendChild(chip);
      });
    }
    col.appendChild(body);
    grid.appendChild(col);
  });
}

/* =========================================================
   TASKS / ASSIGNMENTS
========================================================= */
let taskFilter = "all";
let taskSearchTerm = "";

function openTaskModal(existing){
  const t = existing || { id:uid(), title:"", subject:"", description:"", dueDate:todayISO(), dueTime:"23:59", priority:state.settings.defaultPriority, status:state.settings.defaultStatus, progress:0, notes:"", completed:false };

  const fTitle = input("text", t.title, "Assignment title");
  const fSubject = select(subjectSelectOptions(), t.subject);
  const fDesc = textarea(t.description, "Description");
  const fDate = input("date", t.dueDate);
  const fTime = input("time", t.dueTime);
  const fPriority = select(["Low","Medium","High"], t.priority);
  const fStatus = select(["Not Started","In Progress","Completed"], t.status);
  const fProgress = input("number", t.progress, "0-100");
  fProgress.min=0; fProgress.max=100;
  const fNotes = textarea(t.notes, "Notes");

  const body = el("div", {}, [
    field("Title", fTitle),
    field("Subject", fSubject),
    field("Description", fDesc),
    el("div",{class:"form-grid"}, [ field("Due date", fDate), field("Due time", fTime) ]),
    el("div",{class:"form-grid three"}, [ field("Priority", fPriority), field("Status", fStatus), field("Progress %", fProgress) ]),
    field("Notes", fNotes),
    el("div", {class:"modal-actions"}, [
      existing ? el("button", {class:"btn btn-danger", onclick:()=>{ confirmModal("Delete this assignment?", ()=>deleteTask(t.id)); }}, ["Delete"]) : el("span",{},[]),
      el("div", {class:"modal-actions-right"}, [
        el("button", {class:"btn btn-ghost", onclick:closeModal}, ["Cancel"]),
        el("button", {class:"btn btn-primary", onclick:()=>{
          if(!fTitle.value.trim()){ toast("Please enter a title."); return; }
          t.title = fTitle.value.trim(); t.subject = fSubject.value; t.description = fDesc.value.trim();
          t.dueDate = fDate.value; t.dueTime = fTime.value || "23:59"; t.priority = fPriority.value;
          t.status = fStatus.value; t.progress = Math.max(0, Math.min(100, Number(fProgress.value)||0));
          t.notes = fNotes.value.trim(); t.completed = t.status === "Completed";
          upsertTask(t);
          closeModal();
        }}, [existing ? "Save Changes" : "Add Task"])
      ])
    ])
  ]);
  openModal(existing ? "Edit Assignment" : "Add Assignment", body);
}
function upsertTask(t){
  const idx = state.tasks.findIndex(x=>x.id===t.id);
  if(idx>=0) state.tasks[idx]=t; else state.tasks.push(t);
  saveState(); renderAll(); toast("Assignment saved.");
}
function deleteTask(id){
  state.tasks = state.tasks.filter(t=>t.id!==id);
  saveState(); renderAll(); toast("Assignment deleted.");
}
function toggleTaskComplete(id){
  const t = state.tasks.find(x=>x.id===id);
  if(!t) return;
  t.completed = !t.completed;
  t.status = t.completed ? "Completed" : "In Progress";
  if(t.completed) t.progress = 100;
  saveState(); renderAll();
}
function daysRemaining(t){
  const due = new Date(`${t.dueDate}T${t.dueTime||"23:59"}`);
  const now = new Date();
  return Math.ceil((due-now)/(1000*60*60*24));
}
function isOverdue(t){ return !t.completed && daysRemaining(t) < 0; }
function isToday(t){ return t.dueDate === todayISO(); }

function filteredTasks(){
  let list = state.tasks.slice();
  if(taskSearchTerm){
    const q = taskSearchTerm.toLowerCase();
    list = list.filter(t=> t.title.toLowerCase().includes(q) || subjectName(t.subject).toLowerCase().includes(q));
  }
  if(taskFilter==="today") list = list.filter(isToday);
  else if(taskFilter==="upcoming") list = list.filter(t=>!t.completed && daysRemaining(t)>=0);
  else if(taskFilter==="overdue") list = list.filter(isOverdue);
  else if(taskFilter==="completed") list = list.filter(t=>t.completed);

  const sortMode = $("#task-sort") ? $("#task-sort").value : "due";
  const priorityRank = {High:0, Medium:1, Low:2};
  list.sort((a,b)=>{
    if(sortMode==="priority") return priorityRank[a.priority]-priorityRank[b.priority];
    if(sortMode==="subject") return subjectName(a.subject).localeCompare(subjectName(b.subject));
    if(sortMode==="title") return a.title.localeCompare(b.title);
    return new Date(`${a.dueDate}T${a.dueTime||"23:59"}`) - new Date(`${b.dueDate}T${b.dueTime||"23:59"}`);
  });
  return list;
}

function renderTasks(){
  const list = $("#task-list");
  list.innerHTML = "";
  const items = filteredTasks();
  if(items.length===0){
    list.appendChild(emptyState("No assignments yet", "Add your first assignment to start tracking deadlines."));
    return;
  }
  items.forEach(t=>{
    const overdue = isOverdue(t);
    const row = el("div", {class:"list-row"}, [
      el("div", {class:"task-item"}, [
        el("div", {class:"task-check"+(t.completed?" checked":""), onclick:()=>toggleTaskComplete(t.id)}),
        el("div", {class:"task-main", onclick:()=>openTaskModal(t)}, [
          el("div", {class:"task-title"+(t.completed?" done":"")}, [t.title]),
          el("div", {class:"task-meta"}, [
            el("span",{},[subjectName(t.subject)]),
            el("span",{class:"dot"}),
            el("span",{},[`Due ${t.dueDate} ${fmtTime(t.dueTime)}`]),
            el("span",{class:"dot"}),
            el("span",{class:"badge"+(t.priority==="High"?" solid":"")},[t.priority]),
            overdue ? el("span",{class:"badge"},["Overdue"]) : null,
          ])
        ]),
        el("div", {class:"task-actions"}, [
          el("button", {class:"icon-btn", onclick:()=>openTaskModal(t), "aria-label":"Edit"}, [ el("span",{class:"nav-ico", "data-ico":"note"}) ]),
        ])
      ])
    ]);
    list.appendChild(row);
  });
}

function emptyState(title, sub){
  return el("div", {class:"empty-state"}, [
    el("div", {class:"empty-mark"}, ["–"]),
    el("p", {}, [title]),
    sub ? el("p", {class:"small"}, [sub]) : null
  ]);
}

/* =========================================================
   SUBJECTS
========================================================= */
function openSubjectModal(existing){
  const s = existing || { id:uid(), name:"", code:"", instructor:"", room:"", schedule:"", description:"", notes:"", priority:"Medium" };
  const fName = input("text", s.name, "Subject name");
  const fCode = input("text", s.code, "Subject code");
  const fInstructor = input("text", s.instructor, "Instructor");
  const fRoom = input("text", s.room, "Room");
  const fSchedule = input("text", s.schedule, "e.g. MWF 9:00-10:00");
  const fPriority = select(["Low","Medium","High"], s.priority);
  const fDesc = textarea(s.description, "Description");
  const fNotes = textarea(s.notes, "Notes");

  const body = el("div", {}, [
    field("Subject name", fName),
    el("div",{class:"form-grid"}, [ field("Subject code", fCode), field("Priority level", fPriority) ]),
    el("div",{class:"form-grid"}, [ field("Instructor", fInstructor), field("Room", fRoom) ]),
    field("Schedule summary", fSchedule),
    field("Description", fDesc),
    field("Notes", fNotes),
    el("div", {class:"modal-actions"}, [
      existing ? el("button", {class:"btn btn-danger", onclick:()=>{ confirmModal("Delete this subject? Related classes will keep the subject name as text.", ()=>deleteSubject(s.id)); }}, ["Delete"]) : el("span",{},[]),
      el("div", {class:"modal-actions-right"}, [
        el("button", {class:"btn btn-ghost", onclick:closeModal}, ["Cancel"]),
        el("button", {class:"btn btn-primary", onclick:()=>{
          if(!fName.value.trim()){ toast("Please enter a subject name."); return; }
          s.name=fName.value.trim(); s.code=fCode.value.trim(); s.instructor=fInstructor.value.trim();
          s.room=fRoom.value.trim(); s.schedule=fSchedule.value.trim(); s.priority=fPriority.value;
          s.description=fDesc.value.trim(); s.notes=fNotes.value.trim();
          upsertSubject(s);
          closeModal();
        }}, [existing?"Save Changes":"Add Subject"])
      ])
    ])
  ]);
  openModal(existing?"Edit Subject":"Add Subject", body);
}
function upsertSubject(s){
  const idx = state.subjects.findIndex(x=>x.id===s.id);
  if(idx>=0) state.subjects[idx]=s; else state.subjects.push(s);
  saveState(); renderAll(); toast("Subject saved.");
}
function deleteSubject(id){
  state.subjects = state.subjects.filter(s=>s.id!==id);
  delete state.grades[id];
  saveState(); renderAll(); toast("Subject deleted.");
}

function renderSubjects(){
  const wrap = $("#subject-list");
  wrap.innerHTML = "";
  if(state.subjects.length===0){
    wrap.appendChild(emptyState("No subjects yet", "Add a subject to organize classes, grades, and notes."));
    return;
  }
  state.subjects.forEach(s=>{
    const card = el("div", {class:"subj-card"}, [
      el("div", {class:"subj-card-top"}, [
        el("div", {}, [
          el("div", {class:"subj-name"}, [ el("span",{class:"priority-dot priority-"+s.priority}), " "+s.name ]),
          s.code ? el("div", {class:"subj-code"}, [s.code]) : null
        ])
      ]),
      el("div", {class:"subj-meta-row"}, [
        s.instructor ? el("span",{},["Instructor: "+s.instructor]) : null,
        s.room ? el("span",{},["Room: "+s.room]) : null,
      ]),
      s.schedule ? el("div", {class:"small muted"}, [s.schedule]) : null,
      s.description ? el("div", {class:"small"}, [s.description]) : null,
      el("div", {class:"subj-actions"}, [
        el("button", {class:"btn btn-outline btn-sm", onclick:()=>openSubjectModal(s)}, ["Edit"]),
        el("button", {class:"btn btn-outline btn-sm", onclick:()=>{ switchView("grades"); $("#grades-subject-select").value = s.id; renderGrades(); $all(".nav-item").forEach(b=>b.classList.toggle("active", b.dataset.view==="grades")); }}, ["Grades"]),
        el("button", {class:"btn btn-danger btn-sm", onclick:()=>confirmModal("Delete subject \""+s.name+"\"?", ()=>deleteSubject(s.id))}, ["Delete"]),
      ])
    ]);
    wrap.appendChild(card);
  });
}

/* =========================================================
   GRADES
========================================================= */
function ensureGradeRecord(subjectId){
  if(!state.grades[subjectId]){
    state.grades[subjectId] = { categories:[], targetGrade: state.settings.target };
  }
  return state.grades[subjectId];
}

function computeGrade(record){
  let weightedSum = 0, weightTotal = 0;
  record.categories.forEach(c=>{
    const max = Number(c.max)||0, score = Number(c.score)||0, weight = Number(c.weight)||0;
    if(max>0){
      const pct = score/max*100;
      weightedSum += pct*weight;
      weightTotal += weight;
    }
  });
  const grade = weightTotal>0 ? weightedSum/weightTotal : null;
  return { grade, weightTotal };
}

function renderGrades(){
  const sel = $("#grades-subject-select");
  const prevVal = sel.value;
  sel.innerHTML = "";
  if(state.subjects.length===0){
    sel.appendChild(el("option",{value:""},["No subjects yet"]));
    $("#grades-panel").innerHTML = "";
    $("#grades-panel").appendChild(emptyState("No subjects yet", "Add a subject first to set up its grading categories."));
    return;
  }
  state.subjects.forEach(s=> sel.appendChild(el("option",{value:s.id},[s.name])));
  if(prevVal && state.subjects.find(s=>s.id===prevVal)) sel.value = prevVal;
  renderGradePanel(sel.value);
}

function renderGradePanel(subjectId){
  const panel = $("#grades-panel");
  panel.innerHTML = "";
  if(!subjectId) return;
  const record = ensureGradeRecord(subjectId);
  const { grade, weightTotal } = computeGrade(record);
  const dec = state.settings.decimals;
  const passing = state.settings.passing;

  const summary = el("div", {class:"grade-summary"}, [
    statCard("Current Grade", grade!=null ? grade.toFixed(dec)+"%" : "—"),
    statCard("Target Grade", (record.targetGrade!=null?record.targetGrade:state.settings.target)+"%"),
    statCard("Passing Grade", passing+"%"),
    statCard("Weight Used", weightTotal+"%"),
  ]);
  panel.appendChild(summary);

  const tableCard = el("div", {class:"table-wrap"});
  const table = el("table");
  table.appendChild(el("thead",{},[ el("tr",{},[
    el("th",{},["Category"]), el("th",{},["Score"]), el("th",{},["Max"]), el("th",{},["Weight %"]), el("th",{},["Result"]), el("th",{},[""])
  ])]));
  const tbody = el("tbody");
  if(record.categories.length===0){
    const tr = el("tr",{}, [ el("td",{colspan:"6"},[]) ]);
    tr.querySelector("td").appendChild(emptyState("No categories yet","Add a grading category like Quiz or Exam below."));
    tbody.appendChild(tr);
  }
  record.categories.forEach(c=>{
    const pct = c.max>0 ? (c.score/c.max*100) : 0;
    const tr = el("tr");
    const scoreInput = input("number", c.score); scoreInput.min=0;
    scoreInput.addEventListener("input", ()=>{ c.score=Number(scoreInput.value)||0; saveState(); refreshGradeSummaryOnly(subjectId); });
    const maxInput = input("number", c.max); maxInput.min=0;
    maxInput.addEventListener("input", ()=>{ c.max=Number(maxInput.value)||0; saveState(); refreshGradeSummaryOnly(subjectId); });
    const weightInput = input("number", c.weight); weightInput.min=0;
    weightInput.addEventListener("input", ()=>{ c.weight=Number(weightInput.value)||0; saveState(); refreshGradeSummaryOnly(subjectId); });

    tr.appendChild(el("td",{},[c.name]));
    tr.appendChild(el("td",{},[scoreInput]));
    tr.appendChild(el("td",{},[maxInput]));
    tr.appendChild(el("td",{},[weightInput]));
    tr.appendChild(el("td",{},[ c.max>0 ? pct.toFixed(dec)+"%" : "—" ]));
    tr.appendChild(el("td",{},[ el("button",{class:"icon-btn", onclick:()=>{ record.categories = record.categories.filter(x=>x.id!==c.id); saveState(); renderGradePanel(subjectId); }},[el("span",{class:"nav-ico","data-ico":"close"})]) ]));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableCard.appendChild(table);
  panel.appendChild(tableCard);

  const addRow = el("div", {class:"category-row", style:"margin-top:14px;"});
  const catNameSelect = select([...CATEGORY_TYPES_DEFAULT.map(c=>({value:c,label:c}))], "Quiz");
  const scoreI = input("number","0"); scoreI.min=0;
  const maxI = input("number","100"); maxI.min=0;
  const weightI = input("number","10"); weightI.min=0;
  const addBtn = el("button", {class:"btn btn-primary btn-sm", onclick:()=>{
    record.categories.push({ id:uid(), name:catNameSelect.value, score:Number(scoreI.value)||0, max:Number(maxI.value)||0, weight:Number(weightI.value)||0 });
    saveState(); renderGradePanel(subjectId);
  }}, ["Add"]);
  addRow.appendChild(catNameSelect); addRow.appendChild(scoreI); addRow.appendChild(maxI); addRow.appendChild(weightI); addRow.appendChild(addBtn);
  panel.appendChild(el("div",{class:"card"},[ el("div",{class:"card-head"},[el("h3",{},["Add Grading Category"])]), el("div",{class:"card-body"},[addRow]) ]));

  // Target grade + required score helper
  const targetCard = el("div", {class:"card"}, [
    el("div",{class:"card-head"},[el("h3",{},["Target"])]),
    el("div",{class:"card-body settings-form"},[
      field("Target grade for this subject", (()=>{
        const ti = input("number", record.targetGrade!=null?record.targetGrade:state.settings.target);
        ti.addEventListener("change", ()=>{ record.targetGrade = Number(ti.value)||0; saveState(); refreshGradeSummaryOnly(subjectId); });
        return ti;
      })()),
      el("p",{class:"small muted"}, [ requiredScoreMessage(record, grade, weightTotal) ])
    ])
  ]);
  panel.appendChild(targetCard);
}

function requiredScoreMessage(record, grade, weightTotal){
  const remainingWeight = 100 - weightTotal;
  const target = record.targetGrade!=null ? record.targetGrade : state.settings.target;
  if(remainingWeight <= 0) return grade!=null ? `All weight allocated. Current grade: ${grade.toFixed(state.settings.decimals)}%.` : "All weight allocated.";
  const currentWeighted = grade!=null ? (grade * weightTotal / 100) : 0;
  const neededAvgOnRemaining = ((target - currentWeighted) / remainingWeight) * 100;
  if(neededAvgOnRemaining > 100) return `Reaching ${target}% is very difficult with ${remainingWeight}% weight remaining — you would need more than 100% on what's left.`;
  if(neededAvgOnRemaining < 0) return `You have already secured your ${target}% target based on categories entered so far.`;
  return `To reach ${target}% overall, average about ${neededAvgOnRemaining.toFixed(state.settings.decimals)}% on the remaining ${remainingWeight}% of weight.`;
}

function refreshGradeSummaryOnly(subjectId){ renderGradePanel(subjectId); }

function statCard(label, value){
  return el("div", {class:"stat-card"}, [ el("div",{class:"stat-label"},[label]), el("div",{class:"stat-value"},[value]) ]);
}

/* =========================================================
   FOCUS TIMER
========================================================= */
const focusTimer = {
  mode:"focus", running:false, remaining:25*60, total:25*60, interval:null,
  sessionsThisCycle:0
};
function modeDuration(mode){
  const s = state.settings;
  if(mode==="focus") return s.focusDur*60;
  if(mode==="short") return s.shortDur*60;
  if(mode==="long") return s.longDur*60;
  return s.focusDur*60; // custom defaults to focus dur, user can edit via settings-like inline later
}
function setFocusMode(mode){
  focusTimer.mode = mode;
  focusTimer.running = false;
  clearInterval(focusTimer.interval);
  focusTimer.total = modeDuration(mode);
  focusTimer.remaining = focusTimer.total;
  $all("#focus-modes .tab").forEach(t=>t.classList.toggle("active", t.dataset.mode===mode));
  $("#timer-start").textContent = "Start";
  renderTimerDisplay();
}
function renderTimerDisplay(){
  const m = Math.floor(focusTimer.remaining/60), s = focusTimer.remaining%60;
  $("#timer-time").textContent = `${pad2(m)}:${pad2(s)}`;
  const labelMap = {focus:"Focus session", short:"Short break", long:"Long break", custom:"Custom session"};
  $("#timer-label").textContent = labelMap[focusTimer.mode];
  const ring = $("#ring-fg");
  const circumference = 2*Math.PI*100;
  const pct = focusTimer.total>0 ? (focusTimer.remaining/focusTimer.total) : 0;
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference*(1-pct));
}
function startTimer(){
  if(focusTimer.running) { pauseTimer(); return; }
  focusTimer.running = true;
  $("#timer-start").textContent = "Pause";
  focusTimer.interval = setInterval(()=>{
    focusTimer.remaining--;
    if(focusTimer.remaining<=0){
      completeTimerSession();
      return;
    }
    renderTimerDisplay();
  }, 1000);
}
function pauseTimer(){
  focusTimer.running = false;
  clearInterval(focusTimer.interval);
  $("#timer-start").textContent = "Resume";
}
function resetTimer(){
  focusTimer.running = false;
  clearInterval(focusTimer.interval);
  focusTimer.remaining = focusTimer.total;
  $("#timer-start").textContent = "Start";
  renderTimerDisplay();
}
function completeTimerSession(){
  clearInterval(focusTimer.interval);
  focusTimer.running = false;
  const minutes = Math.round(focusTimer.total/60);
  if(focusTimer.mode === "focus" || focusTimer.mode === "custom"){
    state.focusStats.sessionsCompleted++;
    state.focusStats.totalFocusMinutes += minutes;
    state.focusStats.history.unshift({ date:new Date().toISOString(), mode:focusTimer.mode, minutes });
    state.focusStats.history = state.focusStats.history.slice(0,50);
    focusTimer.sessionsThisCycle++;
    saveState();
    toast("Focus session complete. Nice work.");
  } else {
    toast("Break complete.");
  }
  // auto-advance
  const s = state.settings;
  let next = "focus";
  if(focusTimer.mode==="focus"){
    next = (focusTimer.sessionsThisCycle % s.sessionsBeforeLong === 0) ? "long" : "short";
  }
  setFocusMode(next);
  renderAll();
}
function skipTimer(){
  clearInterval(focusTimer.interval);
  focusTimer.running = false;
  const s = state.settings;
  let next = "focus";
  if(focusTimer.mode==="focus") next = (focusTimer.sessionsThisCycle % s.sessionsBeforeLong === 0) ? "long":"short";
  setFocusMode(next);
}

function renderFocus(){
  const panel = $("#focus-stats-panel");
  panel.innerHTML = "";
  const fs = state.focusStats;
  panel.appendChild(el("div",{class:"focus-stat-row"},[ el("span",{},["Sessions completed"]), el("strong",{},[String(fs.sessionsCompleted)]) ]));
  panel.appendChild(el("div",{class:"focus-stat-row"},[ el("span",{},["Total focus time"]), el("strong",{},[Math.round(fs.totalFocusMinutes/60*10)/10 + " hrs"]) ]));
  const todayCount = fs.history.filter(h=> new Date(h.date).toDateString()===new Date().toDateString() && h.mode!=="short" && h.mode!=="long").length;
  panel.appendChild(el("div",{class:"focus-stat-row"},[ el("span",{},["Sessions today"]), el("strong",{},[String(todayCount)]) ]));
}

/* =========================================================
   NOTES
========================================================= */
let noteSearchTerm = "";
function openNoteModal(existing){
  const n = existing || { id:uid(), title:"", content:"", subject:"", created:new Date().toISOString(), updated:new Date().toISOString(), pinned:false, archived:false };
  const fTitle = input("text", n.title, "Note title");
  const fSubject = select(subjectSelectOptions(), n.subject);
  const fContent = textarea(n.content, "Write your note...");
  fContent.style.minHeight = "140px";

  const body = el("div", {}, [
    field("Title", fTitle),
    field("Subject", fSubject),
    field("Content", fContent),
    el("div", {class:"modal-actions"}, [
      existing ? el("button", {class:"btn btn-danger", onclick:()=>confirmModal("Delete this note?", ()=>deleteNote(n.id))}, ["Delete"]) : el("span",{},[]),
      el("div", {class:"modal-actions-right"}, [
        el("button", {class:"btn btn-ghost", onclick:closeModal}, ["Cancel"]),
        el("button", {class:"btn btn-primary", onclick:()=>{
          if(!fTitle.value.trim()){ toast("Please enter a title."); return; }
          n.title=fTitle.value.trim(); n.subject=fSubject.value; n.content=fContent.value.trim();
          n.updated = new Date().toISOString();
          upsertNote(n);
          closeModal();
        }}, [existing?"Save Changes":"Add Note"])
      ])
    ])
  ]);
  openModal(existing?"Edit Note":"Add Note", body);
}
function upsertNote(n){
  const idx = state.notes.findIndex(x=>x.id===n.id);
  if(idx>=0) state.notes[idx]=n; else state.notes.push(n);
  saveState(); renderAll(); toast("Note saved.");
}
function deleteNote(id){ state.notes = state.notes.filter(n=>n.id!==id); saveState(); renderAll(); toast("Note deleted."); }
function togglePinNote(id){ const n = state.notes.find(x=>x.id===id); if(n){ n.pinned=!n.pinned; saveState(); renderAll(); } }
function toggleArchiveNote(id){ const n = state.notes.find(x=>x.id===id); if(n){ n.archived=!n.archived; saveState(); renderAll(); } }

function renderNotes(){
  const wrap = $("#note-list");
  wrap.innerHTML = "";
  let items = state.notes.filter(n=>!n.archived);
  if(noteSearchTerm){
    const q = noteSearchTerm.toLowerCase();
    items = items.filter(n=> n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
  }
  items.sort((a,b)=> (b.pinned - a.pinned) || (new Date(b.updated)-new Date(a.updated)));
  if(items.length===0){
    wrap.appendChild(emptyState("No notes yet", "Capture quick notes for any subject."));
    return;
  }
  items.forEach(n=>{
    const card = el("div", {class:"note-card"}, [
      el("div", {class:"note-title"}, [ n.pinned ? el("span",{class:"nav-ico","data-ico":"pin"}) : null, n.title ]),
      el("div", {class:"small muted"}, [subjectName(n.subject)]),
      el("div", {class:"note-content"}, [n.content]),
      el("div", {class:"note-meta"}, ["Updated " + new Date(n.updated).toLocaleDateString()]),
      el("div", {class:"note-actions"}, [
        el("button", {class:"btn btn-outline btn-sm", onclick:()=>openNoteModal(n)}, ["Edit"]),
        el("button", {class:"btn btn-outline btn-sm", onclick:()=>togglePinNote(n.id)}, [n.pinned?"Unpin":"Pin"]),
        el("button", {class:"btn btn-outline btn-sm", onclick:()=>toggleArchiveNote(n.id)}, ["Archive"]),
        el("button", {class:"btn btn-danger btn-sm", onclick:()=>confirmModal("Delete this note?", ()=>deleteNote(n.id))}, ["Delete"]),
      ])
    ]);
    wrap.appendChild(card);
  });
}

/* =========================================================
   FILES / RESOURCES
========================================================= */
let fileFilter = "All";
function openFileModal(existing){
  const f = existing || { id:uid(), name:"", url:"", description:"", subject:"", category:"Modules" };
  const fName = input("text", f.name, "Resource name");
  const fUrl = input("url", f.url, "https://...");
  const fDesc = textarea(f.description, "Description");
  const fSubject = select(subjectSelectOptions(), f.subject);
  const fCategory = select(FILE_CATEGORIES, f.category);

  const body = el("div", {}, [
    field("Name", fName),
    field("URL", fUrl),
    field("Description", fDesc),
    el("div",{class:"form-grid"}, [ field("Subject", fSubject), field("Category", fCategory) ]),
    el("div", {class:"modal-actions"}, [
      existing ? el("button", {class:"btn btn-danger", onclick:()=>confirmModal("Delete this resource?", ()=>deleteFile(f.id))}, ["Delete"]) : el("span",{},[]),
      el("div", {class:"modal-actions-right"}, [
        el("button", {class:"btn btn-ghost", onclick:closeModal}, ["Cancel"]),
        el("button", {class:"btn btn-primary", onclick:()=>{
          if(!fName.value.trim() || !fUrl.value.trim()){ toast("Please enter a name and URL."); return; }
          f.name=fName.value.trim(); f.url=fUrl.value.trim(); f.description=fDesc.value.trim();
          f.subject=fSubject.value; f.category=fCategory.value;
          upsertFile(f);
          closeModal();
        }}, [existing?"Save Changes":"Add Resource"])
      ])
    ])
  ]);
  openModal(existing?"Edit Resource":"Add Resource", body);
}
function upsertFile(f){
  const idx = state.files.findIndex(x=>x.id===f.id);
  if(idx>=0) state.files[idx]=f; else state.files.push(f);
  saveState(); renderAll(); toast("Resource saved.");
}
function deleteFile(id){ state.files = state.files.filter(f=>f.id!==id); saveState(); renderAll(); toast("Resource deleted."); }

function renderFiles(){
  const wrap = $("#file-list");
  wrap.innerHTML = "";
  let items = state.files.slice();
  if(fileFilter!=="All") items = items.filter(f=>f.category===fileFilter);
  if(items.length===0){
    wrap.appendChild(emptyState("No saved files", "Save links to modules, references, and school resources."));
    return;
  }
  items.forEach(f=>{
    const row = el("div", {class:"list-row"}, [
      el("div", {class:"task-item"}, [
        el("div", {class:"task-main"}, [
          el("a", {href:f.url, target:"_blank", rel:"noopener", class:"task-title", style:"text-decoration:underline;"}, [f.name]),
          el("div", {class:"task-meta"}, [
            el("span",{class:"badge"},[f.category]),
            f.subject ? el("span",{},[subjectName(f.subject)]) : null,
            f.description ? el("span",{},[f.description]) : null,
          ])
        ]),
        el("div", {class:"task-actions"}, [
          el("button", {class:"btn btn-outline btn-sm", onclick:()=>openFileModal(f)}, ["Edit"]),
          el("button", {class:"btn btn-danger btn-sm", onclick:()=>confirmModal("Delete this resource?", ()=>deleteFile(f.id))}, ["Delete"]),
        ])
      ])
    ]);
    wrap.appendChild(row);
  });
}

/* =========================================================
   DASHBOARD
========================================================= */
function renderDashboard(){
  const h = new Date().getHours();
  const greet = h<12 ? "Good morning" : h<18 ? "Good afternoon" : "Good evening";
  $("#greeting").textContent = `${greet}, ${state.profile.name || "Student"}`;
  $("#greeting-sub").textContent = new Date().toLocaleDateString([], {weekday:"long", month:"long", day:"numeric"});

  // widget visibility
  $all(".widget").forEach(w=>{
    const key = w.dataset.widget;
    w.classList.toggle("hidden", state.settings.widgets[key]===false);
  });

  renderNextClass();
  renderProgressWidget();
  renderTodayScheduleWidget();
  renderTodayTasksWidget();
  renderDeadlinesWidget();
  renderFocusStatsWidget();
}

function nextUpcomingClass(){
  const now = new Date();
  const order = orderedDays();
  const todayIdx = DAYS.indexOf(todayName());
  // check today's remaining classes first, then following days
  for(let offset=0; offset<8; offset++){
    const dayIdx = (todayIdx+offset)%7;
    const day = DAYS[dayIdx];
    const classes = state.classes.filter(c=>c.day===day).sort((a,b)=>a.start.localeCompare(b.start));
    for(const c of classes){
      const classDate = new Date(now);
      classDate.setDate(now.getDate() + offset);
      const [h,m] = c.start.split(":").map(Number);
      classDate.setHours(h,m,0,0);
      if(offset===0 && classDate < now) continue;
      return {c, when: classDate};
    }
  }
  return null;
}

function renderNextClass(){
  const box = $("#widget-nextclass");
  box.innerHTML = "";
  const next = nextUpcomingClass();
  if(!next){
    box.appendChild(emptyState("No upcoming classes"));
    return;
  }
  const {c, when} = next;
  const diffMs = when - new Date();
  const diffMin = Math.max(0, Math.round(diffMs/60000));
  const hrs = Math.floor(diffMin/60), mins = diffMin%60;
  const countdown = diffMin<=0 ? "Starting now" : (hrs>0 ? `in ${hrs}h ${mins}m` : `in ${mins}m`);
  box.appendChild(el("div", {class:"next-class"}, [
    el("div", {class:"nc-subject"}, [subjectName(c.subject)]),
    el("div", {class:"nc-meta"}, [
      el("span",{},[c.day]),
      el("span",{},[`${fmtTime(c.start)}–${fmtTime(c.end)}`]),
      el("span",{},[c.type]),
      c.location ? el("span",{},[c.location]) : null,
    ]),
    el("div", {class:"nc-countdown"}, [countdown]),
  ]));
}

function renderProgressWidget(){
  const box = $("#widget-progress");
  box.innerHTML = "";
  const weekTasks = state.tasks; // overall completion as weekly proxy
  const total = weekTasks.length;
  const done = weekTasks.filter(t=>t.completed).length;
  const pct = total>0 ? Math.round(done/total*100) : 0;
  const circumference = 2*Math.PI*46;
  const wrap = el("div", {class:"progress-block"}, [
    el("div", {class:"progress-ring-wrap"}, [
      (()=>{ const svg = document.createElementNS("http://www.w3.org/2000/svg","svg"); svg.setAttribute("viewBox","0 0 110 110");
        const bg = document.createElementNS("http://www.w3.org/2000/svg","circle"); bg.setAttribute("class","ring-bg"); bg.setAttribute("cx","55"); bg.setAttribute("cy","55"); bg.setAttribute("r","46");
        const fg = document.createElementNS("http://www.w3.org/2000/svg","circle"); fg.setAttribute("class","ring-fg"); fg.setAttribute("cx","55"); fg.setAttribute("cy","55"); fg.setAttribute("r","46");
        fg.setAttribute("stroke-dasharray", String(circumference));
        fg.setAttribute("stroke-dashoffset", String(circumference*(1-pct/100)));
        svg.appendChild(bg); svg.appendChild(fg);
        return svg;
      })(),
      el("div", {class:"progress-pct"}, [pct+"%"])
    ]),
    el("div", {class:"progress-caption"}, [`${done} of ${total} tasks completed`])
  ]);
  box.appendChild(wrap);
}

function renderTodayScheduleWidget(){
  const box = $("#widget-todayschedule");
  box.innerHTML = "";
  const day = todayName();
  const items = state.classes.filter(c=>c.day===day).sort((a,b)=>a.start.localeCompare(b.start));
  if(items.length===0){ box.appendChild(emptyState("No classes")); return; }
  items.forEach(c=>{
    box.appendChild(el("div", {class:"sched-item"}, [
      el("div", {class:"sched-time"}, [`${fmtTime(c.start)}–${fmtTime(c.end)}`]),
      el("div", {class:"sched-info"}, [
        el("div", {class:"sched-subject"}, [subjectName(c.subject)]),
        el("div", {class:"sched-meta"}, [`${c.type}${c.location?" · "+c.location:""}`])
      ])
    ]));
  });
}

function renderTodayTasksWidget(){
  const box = $("#widget-todaytasks");
  box.innerHTML = "";
  const items = state.tasks.filter(isToday);
  if(items.length===0){ box.appendChild(emptyState("No tasks due today")); return; }
  items.forEach(t=>{
    box.appendChild(el("div", {class:"task-item"}, [
      el("div", {class:"task-check"+(t.completed?" checked":""), onclick:()=>toggleTaskComplete(t.id)}),
      el("div", {class:"task-main"}, [
        el("div", {class:"task-title"+(t.completed?" done":"")}, [t.title]),
        el("div", {class:"task-meta"}, [ el("span",{},[subjectName(t.subject)]), el("span",{class:"badge"},[t.priority]) ])
      ])
    ]));
  });
}

function renderDeadlinesWidget(){
  const box = $("#widget-deadlines");
  box.innerHTML = "";
  const items = state.tasks.filter(t=>!t.completed).sort((a,b)=>daysRemaining(a)-daysRemaining(b)).slice(0,5);
  if(items.length===0){ box.appendChild(emptyState("No upcoming deadlines")); return; }
  items.forEach(t=>{
    const dr = daysRemaining(t);
    box.appendChild(el("div", {class:"sched-item"}, [
      el("div", {class:"sched-time"}, [ dr<0 ? "Overdue" : dr===0 ? "Today" : `${dr}d left` ]),
      el("div", {class:"sched-info"}, [
        el("div", {class:"sched-subject"}, [t.title]),
        el("div", {class:"sched-meta"}, [subjectName(t.subject)+" · "+t.dueDate])
      ])
    ]));
  });
}

function renderFocusStatsWidget(){
  const box = $("#widget-focusstats");
  box.innerHTML = "";
  const fs = state.focusStats;
  box.appendChild(el("div",{class:"focus-stat-row"},[el("span",{},["Sessions completed"]), el("strong",{},[String(fs.sessionsCompleted)])]));
  box.appendChild(el("div",{class:"focus-stat-row"},[el("span",{},["Total focus time"]), el("strong",{},[Math.round(fs.totalFocusMinutes/60*10)/10+" hrs"])]));
}

/* =========================================================
   SETTINGS
========================================================= */
function fillSettingsForm(){
  const p = state.profile, s = state.settings;
  $("#s-name").value = p.name; $("#s-studentid").value = p.studentId; $("#s-program").value = p.program;
  $("#s-year").value = p.year; $("#s-section").value = p.section; $("#s-school").value = p.school; $("#s-email").value = p.email;

  $("#s-weekstart").value = s.weekStart; $("#s-timeformat").value = s.timeFormat; $("#s-classduration").value = s.classDuration;
  const dctSel = $("#s-defaultclasstype"); dctSel.innerHTML="";
  s.classTypes.forEach(t=> dctSel.appendChild(el("option",{value:t},[t])));
  dctSel.value = s.defaultClassType;

  $("#s-defaultpriority").value = s.defaultPriority; $("#s-defaultstatus").value = s.defaultStatus; $("#s-tasksort").value = s.taskSort;
  $("#s-passing").value = s.passing; $("#s-target").value = s.target; $("#s-decimals").value = s.decimals;
  $("#s-focusdur").value = s.focusDur; $("#s-shortdur").value = s.shortDur; $("#s-longdur").value = s.longDur; $("#s-sessionsbeforelong").value = s.sessionsBeforeLong;
  $("#s-theme").value = s.theme; $("#s-density").value = s.density; $("#s-radius").value = s.radius; $("#s-reducemotion").checked = s.reduceMotion;

  const wt = $("#widget-toggles"); wt.innerHTML = "";
  Object.keys(WIDGET_LABELS).forEach(key=>{
    const cb = el("input", {type:"checkbox"});
    cb.checked = s.widgets[key] !== false;
    cb.dataset.widgetKey = key;
    wt.appendChild(el("label", {class:"widget-toggle"}, [cb, WIDGET_LABELS[key]]));
  });
}

function saveSettingsForm(){
  const p = state.profile, s = state.settings;
  p.name = $("#s-name").value.trim() || "Student";
  p.studentId = $("#s-studentid").value.trim();
  p.program = $("#s-program").value.trim() || "My Program";
  p.year = $("#s-year").value.trim();
  p.section = $("#s-section").value.trim();
  p.school = $("#s-school").value.trim() || "My College";
  p.email = $("#s-email").value.trim();

  s.weekStart = $("#s-weekstart").value; s.timeFormat = $("#s-timeformat").value; s.classDuration = Number($("#s-classduration").value)||60;
  s.defaultClassType = $("#s-defaultclasstype").value;
  s.defaultPriority = $("#s-defaultpriority").value; s.defaultStatus = $("#s-defaultstatus").value; s.taskSort = $("#s-tasksort").value;
  s.passing = Number($("#s-passing").value)||0; s.target = Number($("#s-target").value)||0; s.decimals = Number($("#s-decimals").value)||2;
  s.focusDur = Number($("#s-focusdur").value)||25; s.shortDur = Number($("#s-shortdur").value)||5; s.longDur = Number($("#s-longdur").value)||15;
  s.sessionsBeforeLong = Number($("#s-sessionsbeforelong").value)||4;
  s.theme = $("#s-theme").value; s.density = $("#s-density").value; s.radius = $("#s-radius").value; s.reduceMotion = $("#s-reducemotion").checked;

  $all("#widget-toggles input[type=checkbox]").forEach(cb=>{
    s.widgets[cb.dataset.widgetKey] = cb.checked;
  });

  saveState();
  applyAppearance();
  setFocusMode(focusTimer.mode);
  renderAll();
  toast("Settings saved.");
}

function exportData(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "coursework-backup.json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Data exported.");
}
function importData(file){
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{
      const parsed = JSON.parse(e.target.result);
      state = deepMerge(defaultState(), parsed);
      saveState();
      applyAppearance();
      fillSettingsForm();
      renderAll();
      toast("Data imported.");
    }catch(err){
      toast("Import failed — invalid file.");
    }
  };
  reader.readAsText(file);
}
function resetData(){
  confirmModal("This will permanently delete all your data. Continue?", ()=>{
    state = defaultState();
    saveState();
    applyAppearance();
    location.reload();
  });
}

/* =========================================================
   IMPORT SCHEDULE FROM IMAGE (client-side OCR, no backend)
========================================================= */
let _tesseractLoading = null;
function loadTesseract(){
  if(window.Tesseract) return Promise.resolve();
  if(_tesseractLoading) return _tesseractLoading;
  _tesseractLoading = new Promise((resolve, reject)=>{
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = ()=>resolve();
    s.onerror = ()=>reject(new Error("Could not load OCR engine. Check your internet connection."));
    document.head.appendChild(s);
  });
  return _tesseractLoading;
}

const DAY_TOKENS = {
  "MONDAY":"Monday","MON":"Monday","M":"Monday",
  "TUESDAY":"Tuesday","TUES":"Tuesday","TUE":"Tuesday","T":"Tuesday",
  "WEDNESDAY":"Wednesday","WED":"Wednesday","W":"Wednesday",
  "THURSDAY":"Thursday","THURS":"Thursday","THU":"Thursday","TH":"Thursday",
  "FRIDAY":"Friday","FRI":"Friday","F":"Friday",
  "SATURDAY":"Saturday","SAT":"Saturday","S":"Saturday","SA":"Saturday",
  "SUNDAY":"Sunday","SUN":"Sunday","SU":"Sunday"
};
const DAY_HEADER_RE = /\b(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)\b/i;
const TIME_RANGE_RE = /(\d{1,2})[:.]?(\d{2})?\s*(AM|PM)?\s*[-–—to]{1,3}\s*(\d{1,2})[:.]?(\d{2})?\s*(AM|PM)?/i;
const NO_CLASS_RE = /\bNO\s+CLASSES?\b/i;
const ROOM_RE = /\b([A-Z]{1,4}\d[\w.\-]*|ROOM\s*\d+\w*|RM\.?\s*\d+\w*)\b/;

function to24h(h, m, period){
  h = Number(h); m = m ? Number(m) : 0;
  if(period){
    const p = period.toUpperCase();
    if(p==="PM" && h!==12) h+=12;
    if(p==="AM" && h===12) h=0;
  }
  if(h>23) h=23;
  return `${pad2(h)}:${pad2(m)}`;
}

function detectClassType(line){
  const l = line.toUpperCase();
  if(l.includes("ZOOM") || l.includes("ONLINE") || l.includes("GMEET") || l.includes("GOOGLE MEET")) return "Zoom";
  if(l.includes("FACE") && l.includes("FACE")) return "Face to Face";
  if(l.includes("GYM")) return "Face to Face";
  return state.settings.defaultClassType;
}

const TYPE_LINE_RE = /^(ZOOM|ONLINE|GOOGLE MEET|GMEET|FACE\s*TO\s*FACE|FACE-TO-FACE|GYM(\s*\/\s*FACE-?TO-?FACE)?)$/i;
const ROOM_LINE_RE = /^(ROOM\s*\d+\w*|RM\.?\s*\d+\w*|[A-Z]{1,4}\d[\w.\-]*)$/i;

/**
 * Parses raw OCR text into candidate class rows.
 * Schedule graphics from most schools render each class as a cluster of lines:
 *   [optional] a DAY heading line
 *   a TIME RANGE line (e.g. "7:30 AM-9:00 AM") — may appear before or after the subject
 *   one or more SUBJECT NAME line(s) (often wrapped across 2 lines)
 *   a TYPE line (Zoom / Face to Face / Gym) and/or a ROOM code line (e.g. "B1.24")
 * This walks the lines once, buffering pieces (time / subject / type / room) and
 * flushing a class row whenever a new time range or day heading starts a fresh cluster.
 */
function parseScheduleText(rawText){
  const lines = rawText.split("\n").map(l=>l.trim()).filter(Boolean);
  const rows = [];
  let currentDay = null;

  let buf = null; // { start, end, subjectParts:[], type, room }
  function flush(){
    if(buf && buf.start && buf.end && buf.subjectParts.length && currentDay){
      const subject = buf.subjectParts.join(" ").replace(/\s+/g," ").trim();
      rows.push({
        id: uid(), include:true, day: currentDay, subject,
        start: buf.start, end: buf.end, room: buf.room || "",
        type: buf.type || state.settings.defaultClassType
      });
    }
    buf = null;
  }

  for(let i=0;i<lines.length;i++){
    const line = lines[i];

    const dayMatch = line.match(DAY_HEADER_RE);
    if(dayMatch && line.replace(dayMatch[0],"").trim().length < 3){
      flush();
      currentDay = DAY_TOKENS[dayMatch[1].toUpperCase()] || dayMatch[1];
      continue;
    }

    if(NO_CLASS_RE.test(line)){ flush(); continue; }

    const timeMatch = line.match(TIME_RANGE_RE);
    if(timeMatch){
      flush(); // a new time range starts a new class cluster
      const start = to24h(timeMatch[1], timeMatch[2], timeMatch[3] || timeMatch[6]);
      const end = to24h(timeMatch[4], timeMatch[5], timeMatch[6] || timeMatch[3]);
      buf = { start, end, subjectParts: [], type:null, room:null };
      // Same line might also contain trailing subject/room text (table-row style)
      const remainder = line.replace(timeMatch[0], "").replace(/^[|\-–:]+|[|\-–:]+$/g,"").trim();
      if(remainder){
        const roomMatch = remainder.match(ROOM_RE);
        if(roomMatch) buf.room = roomMatch[0];
        let subj = remainder.replace(ROOM_RE,"").replace(/FACE\s*TO\s*FACE|ZOOM|ONLINE/ig,"").trim();
        if(subj) buf.subjectParts.push(subj);
        if(/ZOOM|FACE\s*TO\s*FACE|ONLINE|GYM/i.test(remainder)) buf.type = detectClassType(remainder);
      }
      continue;
    }

    if(!buf) continue; // no open class cluster yet, ignore stray text (titles, headers, etc.)

    if(TYPE_LINE_RE.test(line)){
      buf.type = detectClassType(line);
      continue;
    }
    if(ROOM_LINE_RE.test(line) && !/^[A-Z]{2,}$/i.test(line)){
      buf.room = line;
      continue;
    }
    if(/[A-Za-z]{2,}/.test(line)){
      buf.subjectParts.push(line);
    }
  }
  flush();

  // De-dupe identical rows
  const seen = new Set();
  return rows.filter(r=>{
    const key = `${r.day}|${r.start}|${r.end}|${r.subject.toUpperCase()}`;
    if(seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function openImportImageModal(){
  let extractedRows = [];
  let imgDataUrl = null;

  const dropZone = el("div", {class:"import-drop", id:"imp-drop"}, [
    el("div", {class:"imp-icon"}, ["📷"]),
    el("p", {}, [el("strong",{},["Click to upload"]), " or drag a photo/screenshot of your class schedule"]),
    el("p", {class:"small muted"}, ["JPG or PNG · processed entirely in your browser"]),
    el("input", {type:"file", accept:"image/*", id:"imp-file"})
  ]);

  const progressWrap = el("div", {class:"import-progress-wrap hidden", id:"imp-progress-wrap"}, [
    el("div", {class:"import-progress-bar"}, [ el("div", {class:"import-progress-fill", id:"imp-progress-fill"}) ]),
    el("div", {class:"import-progress-label", id:"imp-progress-label"}, ["Reading image…"])
  ]);

  const resultsWrap = el("div", {class:"hidden", id:"imp-results"});

  const body = el("div", {}, [ dropZone, progressWrap, resultsWrap ]);
  openModal("Import Schedule from Image", body);

  function setProgress(pct, label){
    $("#imp-progress-fill").style.width = pct+"%";
    if(label) $("#imp-progress-label").textContent = label;
  }

  async function handleFile(file){
    if(!file || !file.type.startsWith("image/")){ toast("Please choose an image file."); return; }
    const reader = new FileReader();
    reader.onload = async (e)=>{
      imgDataUrl = e.target.result;
      dropZone.innerHTML = "";
      dropZone.appendChild(el("img", {class:"import-preview", src:imgDataUrl}));
      $("#imp-progress-wrap").classList.remove("hidden");
      setProgress(5, "Loading OCR engine…");
      try{
        await loadTesseract();
        setProgress(15, "Reading image…");
        const { data } = await window.Tesseract.recognize(imgDataUrl, "eng", {
          logger: (m)=>{
            if(m.status === "recognizing text" && m.progress != null){
              setProgress(15 + Math.round(m.progress*75), "Reading image… " + Math.round(m.progress*100) + "%");
            }
          }
        });
        setProgress(95, "Parsing schedule…");
        extractedRows = parseScheduleText(data.text || "");
        setProgress(100, "Done");
        renderResults();
      }catch(err){
        console.error(err);
        toast(err.message || "OCR failed. Please try a clearer image.");
        $("#imp-progress-wrap").classList.add("hidden");
      }
    };
    reader.readAsDataURL(file);
  }

  dropZone.addEventListener("click", (e)=>{ if(e.target.tagName!=="INPUT") $("#imp-file").click(); });
  $("#imp-file", dropZone).addEventListener("change", (e)=> handleFile(e.target.files[0]));
  ["dragover","dragenter"].forEach(evt=> dropZone.addEventListener(evt, (e)=>{ e.preventDefault(); dropZone.classList.add("dragover"); }));
  ["dragleave","drop"].forEach(evt=> dropZone.addEventListener(evt, (e)=>{ e.preventDefault(); dropZone.classList.remove("dragover"); }));
  dropZone.addEventListener("drop", (e)=>{ if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

  function makeRowEl(r){
    const tr = el("tr", {"data-id": r.id, class: r.include ? "" : "row-excluded"});
    const chk = el("input", {type:"checkbox"}); chk.checked = r.include;
    chk.addEventListener("change", ()=>{ r.include = chk.checked; tr.classList.toggle("row-excluded", !r.include); });

    const subjInput = input("text", r.subject, "Subject name");
    subjInput.addEventListener("input", ()=> r.subject = subjInput.value);

    const daySelect = select(DAYS, r.day);
    daySelect.addEventListener("change", ()=> r.day = daySelect.value);

    const startInput = input("time", r.start); startInput.addEventListener("input", ()=> r.start = startInput.value);
    const endInput = input("time", r.end); endInput.addEventListener("input", ()=> r.end = endInput.value);

    const typeSelect = select(state.settings.classTypes, r.type);
    typeSelect.addEventListener("change", ()=> r.type = typeSelect.value);

    const roomInput = input("text", r.room, "Room");
    roomInput.addEventListener("input", ()=> r.room = roomInput.value);

    const removeBtn = el("button", {class:"import-row-remove", title:"Remove row", onclick:()=>{
      extractedRows = extractedRows.filter(x=>x.id!==r.id);
      tr.remove();
    }}, ["✕"]);

    tr.appendChild(el("td",{},[chk]));
    tr.appendChild(el("td",{},[subjInput]));
    tr.appendChild(el("td",{},[daySelect]));
    tr.appendChild(el("td",{},[startInput]));
    tr.appendChild(el("td",{},[endInput]));
    tr.appendChild(el("td",{},[typeSelect]));
    tr.appendChild(el("td",{},[roomInput]));
    tr.appendChild(el("td",{},[removeBtn]));
    return tr;
  }

  function renderResults(){
    resultsWrap.innerHTML = "";
    resultsWrap.classList.remove("hidden");

    if(extractedRows.length===0){
      resultsWrap.appendChild(el("div",{class:"import-hint"}, [
        "Couldn't confidently detect any classes in that image. You can add a row manually below, or try a clearer / less cropped photo."
      ]));
    } else {
      resultsWrap.appendChild(el("p", {class:"import-hint"}, [
        `Found ${extractedRows.length} possible ${extractedRows.length===1?"class":"classes"}. Review and fix anything OCR got wrong, uncheck what you don't want, then import.`
      ]));
    }

    const table = el("table", {class:"import-table"});
    const thead = el("thead", {}, [ el("tr", {}, [
      el("th",{},["✓"]), el("th",{},["Subject"]), el("th",{},["Day"]), el("th",{},["Start"]),
      el("th",{},["End"]), el("th",{},["Type"]), el("th",{},["Room"]), el("th",{},[""])
    ]) ]);
    const tbody = el("tbody", {id:"imp-tbody"});
    extractedRows.forEach(r=> tbody.appendChild(makeRowEl(r)));
    table.appendChild(thead); table.appendChild(tbody);
    resultsWrap.appendChild(el("div", {class:"import-table-wrap"}, [table]));

    const addRowBtn = el("button", {class:"btn btn-outline import-add-row", onclick:()=>{
      const r = { id:uid(), include:true, day:todayName(), subject:"", start:"08:00", end:"09:00", room:"", type: state.settings.defaultClassType };
      extractedRows.push(r);
      tbody.appendChild(makeRowEl(r));
    }}, ["+ Add row"]);
    resultsWrap.appendChild(addRowBtn);

    resultsWrap.appendChild(el("div", {class:"modal-actions"}, [
      el("button", {class:"btn btn-ghost", onclick:closeModal}, ["Cancel"]),
      el("div", {class:"modal-actions-right"}, [
        el("button", {class:"btn btn-primary", onclick:()=>{
          const toImport = extractedRows.filter(r=>r.include && r.subject.trim() && r.day && r.start && r.end);
          if(toImport.length===0){ toast("Nothing selected to import."); return; }
          let added = 0;
          toImport.forEach(r=>{
            const name = r.subject.trim();
            let subj = state.subjects.find(s=>s.name.toLowerCase()===name.toLowerCase());
            if(!subj){
              subj = { id:uid(), name, code:"", instructor:"", room:r.room.trim(), schedule:"", description:"", notes:"", priority:"Medium" };
              state.subjects.push(subj);
            }
            state.classes.push({
              id: uid(), subject: subj.id, day: r.day, start: r.start, end: r.end,
              location: r.room.trim(), type: r.type || state.settings.defaultClassType,
              instructor:"", room:r.room.trim(), notes:"Imported from image"
            });
            added++;
          });
          saveState(); renderAll(); closeModal();
          toast(`Imported ${added} class${added===1?"":"es"}.`);
        }}, ["Import Selected"])
      ])
    ]));
  }
}

/* =========================================================
   SEARCH
========================================================= */
function runSearch(term){
  const box = $("#search-results");
  if(!term){ box.classList.add("hidden"); box.innerHTML=""; return; }
  box.classList.remove("hidden");
  box.innerHTML = "";
  const q = term.toLowerCase();

  const groups = [
    { label:"Subjects", items: state.subjects.filter(s=>s.name.toLowerCase().includes(q)).map(s=>({label:s.name, action:()=>{switchToNav("subjects"); openSubjectModal(s);} })) },
    { label:"Classes", items: state.classes.filter(c=>subjectName(c.subject).toLowerCase().includes(q) || c.location.toLowerCase().includes(q)).map(c=>({label:`${subjectName(c.subject)} — ${c.day} ${fmtTime(c.start)}`, action:()=>{switchToNav("schedule"); openClassModal(c);} })) },
    { label:"Assignments", items: state.tasks.filter(t=>t.title.toLowerCase().includes(q)).map(t=>({label:t.title, action:()=>{switchToNav("assignments"); openTaskModal(t);} })) },
    { label:"Notes", items: state.notes.filter(n=>n.title.toLowerCase().includes(q)||n.content.toLowerCase().includes(q)).map(n=>({label:n.title, action:()=>{switchToNav("notes"); openNoteModal(n);} })) },
    { label:"Files", items: state.files.filter(f=>f.name.toLowerCase().includes(q)).map(f=>({label:f.name, action:()=>{switchToNav("files"); openFileModal(f);} })) },
  ];
  const anyResults = groups.some(g=>g.items.length>0);
  if(!anyResults){
    box.appendChild(el("div",{class:"sr-empty"},["No results for \""+term+"\""]));
    return;
  }
  groups.forEach(g=>{
    if(g.items.length===0) return;
    const gEl = el("div",{class:"sr-group"},[ el("h4",{},[g.label]) ]);
    g.items.slice(0,6).forEach(it=>{
      gEl.appendChild(el("div",{class:"sr-item", onclick:()=>{ it.action(); box.classList.add("hidden"); $("#global-search").value=""; }},[it.label]));
    });
    box.appendChild(gEl);
  });
}
function switchToNav(view){
  switchView(view);
}

/* =========================================================
   FIRST-TIME SETUP
========================================================= */
function showSetupIfNeeded(){
  if(state.setupDone){
    $("#setup-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    return;
  }
  $("#setup-screen").classList.remove("hidden");
  $("#app").classList.add("hidden");
}
function finishSetup(skip){
  if(!skip){
    state.profile.name = $("#setup-name").value.trim() || "Student";
    state.profile.school = $("#setup-school").value.trim() || "My College";
    state.profile.program = $("#setup-program").value.trim() || "My Program";
    state.profile.year = $("#setup-year").value.trim();
  }
  state.setupDone = true;
  saveState();
  $("#setup-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  renderAll();
}

/* =========================================================
   RENDER ALL
========================================================= */
function renderAll(){
  $("#mini-name").textContent = state.profile.name || "Student";
  $("#mini-sub").textContent = state.profile.program || "My Program";
  $("#mini-avatar").textContent = (state.profile.name||"S").trim().charAt(0).toUpperCase() || "S";

  renderDashboard();
  renderSchedule();
  renderTasks();
  renderSubjects();
  renderNotes();
  renderFiles();
  renderFocus();
  if($("#view-grades").classList.contains("active")) renderGrades();
}

/* =========================================================
   EVENT WIRING
========================================================= */
function wireEvents(){
  // setup
  $("#setup-finish").addEventListener("click", ()=>finishSetup(false));
  $("#setup-skip").addEventListener("click", ()=>finishSetup(true));

  // nav
  $all(".nav-item").forEach(btn=> btn.addEventListener("click", ()=>switchView(btn.dataset.view)));
  $("#hamburger").addEventListener("click", openSidebarMobile);
  $("#scrim").addEventListener("click", closeSidebarMobile);
  $("#header-settings").addEventListener("click", ()=>switchView("settings"));
  $("#theme-toggle").addEventListener("click", toggleTheme);

  // clock
  tickClock();
  setInterval(tickClock, 1000);

  // modal close
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-overlay").addEventListener("click", (e)=>{ if(e.target.id==="modal-overlay") closeModal(); });
  document.addEventListener("keydown", (e)=>{ if(e.key==="Escape") closeModal(); });

  // quick actions + add buttons (event delegation)
  document.addEventListener("click", (e)=>{
    const actionBtn = e.target.closest("[data-action]");
    if(!actionBtn) return;
    const action = actionBtn.dataset.action;
    if(action==="add-class") openClassModal();
    else if(action==="add-task") openTaskModal();
    else if(action==="add-subject") openSubjectModal();
    else if(action==="add-note") openNoteModal();
    else if(action==="add-file") openFileModal();
    else if(action==="start-focus"){ switchView("focus"); }
    else if(action==="import-image") openImportImageModal();
  });

  // task filters
  $all("#task-filters .tab").forEach(t=> t.addEventListener("click", ()=>{
    $all("#task-filters .tab").forEach(x=>x.classList.remove("active"));
    t.classList.add("active"); taskFilter = t.dataset.filter; renderTasks();
  }));
  $("#task-search").addEventListener("input", (e)=>{ taskSearchTerm = e.target.value; renderTasks(); });
  $("#task-sort").addEventListener("change", renderTasks);

  // file filters
  $all("#file-filters .tab").forEach(t=> t.addEventListener("click", ()=>{
    $all("#file-filters .tab").forEach(x=>x.classList.remove("active"));
    t.classList.add("active"); fileFilter = t.dataset.cat; renderFiles();
  }));

  // note search
  $("#note-search").addEventListener("input", (e)=>{ noteSearchTerm = e.target.value; renderNotes(); });

  // grades subject select
  $("#grades-subject-select").addEventListener("change", (e)=>renderGradePanel(e.target.value));

  // focus timer
  $all("#focus-modes .tab").forEach(t=> t.addEventListener("click", ()=>setFocusMode(t.dataset.mode)));
  $("#timer-start").addEventListener("click", startTimer);
  $("#timer-reset").addEventListener("click", resetTimer);
  $("#timer-skip").addEventListener("click", skipTimer);

  // search
  $("#global-search").addEventListener("input", (e)=>runSearch(e.target.value.trim()));
  document.addEventListener("click", (e)=>{
    if(!e.target.closest(".topbar-search") && !e.target.closest("#search-results")){
      $("#search-results").classList.add("hidden");
    }
  });

  // settings
  $("#btn-save-settings").addEventListener("click", saveSettingsForm);
  $("#btn-export").addEventListener("click", exportData);
  $("#btn-import").addEventListener("click", ()=>$("#import-file").click());
  $("#import-file").addEventListener("change", (e)=>{ if(e.target.files[0]) importData(e.target.files[0]); e.target.value=""; });
  $("#btn-reset").addEventListener("click", resetData);
}

/* =========================================================
   INIT
========================================================= */
function init(){
  applyAppearance();
  showSetupIfNeeded();
  wireEvents();
  fillSettingsForm();
  setFocusMode("focus");
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);

})();
