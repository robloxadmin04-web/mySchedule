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

  // Instant apply for appearance controls
  ["s-theme","s-density","s-radius"].forEach(id=>{
    const el = $("#"+id);
    if(el && !el._instantWired){
      el.addEventListener("change", ()=>{
        state.settings.theme = $("#s-theme").value;
        state.settings.density = $("#s-density").value;
        state.settings.radius = $("#s-radius").value;
        applyAppearance();
        saveState();
      });
      el._instantWired = true;
    }
  });
  const rm = $("#s-reducemotion");
  if(rm && !rm._instantWired){
    rm.addEventListener("change", ()=>{
      state.settings.reduceMotion = rm.checked;
      applyAppearance();
      saveState();
    });
    rm._instantWired = true;
  }

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

// Load jsPDF from CDN on demand
let _jspdfLoading = null;
function loadJsPdf(){
  if(window.jspdf) return Promise.resolve();
  if(_jspdfLoading) return _jspdfLoading;
  _jspdfLoading = new Promise((resolve, reject)=>{
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = ()=>{
      const s2 = document.createElement("script");
      s2.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
      s2.onload = ()=>resolve();
      s2.onerror = ()=>reject(new Error("Could not load PDF library."));
      document.head.appendChild(s2);
    };
    s.onerror = ()=>reject(new Error("Could not load PDF library."));
    document.head.appendChild(s);
  });
  return _jspdfLoading;
}

async function exportDataPdf(){
  toast("Generating PDF...");
  try{
    await loadJsPdf();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:"pt", format:"a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 40;
    let y = margin;

    // Title
    doc.setFontSize(18); doc.setFont("helvetica","bold");
    doc.text(state.profile.name || "My Coursework", margin, y); y += 22;
    doc.setFontSize(11); doc.setFont("helvetica","normal"); doc.setTextColor(120);
    const subLine = [
      state.profile.program, state.profile.year, state.profile.section, state.profile.school
    ].filter(Boolean).join(" • ");
    if(subLine){ doc.text(subLine, margin, y); y += 14; }
    doc.setTextColor(150); doc.setFontSize(9);
    doc.text("Exported " + new Date().toLocaleString(), margin, y); y += 20;
    doc.setTextColor(0);

    // SUBJECTS
    if(state.subjects.length){
      doc.setFontSize(13); doc.setFont("helvetica","bold");
      doc.text("Subjects", margin, y); y += 6;
      doc.autoTable({
        startY: y + 4,
        head: [["Subject","Code","Instructor","Room"]],
        body: state.subjects.map(s=>[s.name||"", s.code||"", s.instructor||"", s.room||""]),
        theme:"striped", styles:{fontSize:9, cellPadding:4},
        headStyles:{fillColor:[45,45,55], textColor:255},
        margin:{left:margin, right:margin}
      });
      y = doc.lastAutoTable.finalY + 18;
    }

    // SCHEDULE
    if(state.classes.length){
      if(y > 720){ doc.addPage(); y = margin; }
      doc.setFontSize(13); doc.setFont("helvetica","bold");
      doc.text("Weekly Schedule", margin, y); y += 6;
      const dayOrder = {Monday:1,Tuesday:2,Wednesday:3,Thursday:4,Friday:5,Saturday:6,Sunday:7};
      const sortedClasses = [...state.classes].sort((a,b)=>{
        const da = (dayOrder[a.day]||8) - (dayOrder[b.day]||8);
        if(da !== 0) return da;
        return (a.start||"").localeCompare(b.start||"");
      });
      doc.autoTable({
        startY: y + 4,
        head: [["Day","Start","End","Subject","Room","Type"]],
        body: sortedClasses.map(cls=>{
          const subj = state.subjects.find(s=>s.id===cls.subject);
          return [cls.day||"", cls.start||"", cls.end||"", subj ? subj.name : "?", cls.room||cls.location||"", cls.type||""];
        }),
        theme:"striped", styles:{fontSize:9, cellPadding:4},
        headStyles:{fillColor:[45,45,55], textColor:255},
        margin:{left:margin, right:margin}
      });
      y = doc.lastAutoTable.finalY + 18;
    }

    // ASSIGNMENTS / TASKS
    if(state.tasks && state.tasks.length){
      if(y > 720){ doc.addPage(); y = margin; }
      doc.setFontSize(13); doc.setFont("helvetica","bold");
      doc.text("Assignments", margin, y); y += 6;
      doc.autoTable({
        startY: y + 4,
        head: [["Title","Subject","Due","Priority","Status"]],
        body: state.tasks.map(t=>{
          const subj = state.subjects.find(s=>s.id===t.subject);
          return [t.title||"", subj?subj.name:"", t.due||"", t.priority||"", t.status||""];
        }),
        theme:"striped", styles:{fontSize:9, cellPadding:4},
        headStyles:{fillColor:[45,45,55], textColor:255},
        margin:{left:margin, right:margin}
      });
      y = doc.lastAutoTable.finalY + 18;
    }

    // GRADES
    if(state.grades && Object.keys(state.grades).length){
      if(y > 720){ doc.addPage(); y = margin; }
      doc.setFontSize(13); doc.setFont("helvetica","bold");
      doc.text("Grades", margin, y); y += 6;
      const gradeRows = [];
      Object.entries(state.grades).forEach(([subjId, rec])=>{
        const subj = state.subjects.find(s=>s.id===subjId);
        const name = subj ? subj.name : "?";
        (rec.categories||[]).forEach(cat=>{
          gradeRows.push([name, cat.name||"", cat.score||0, cat.max||100, (cat.weight||0)+"%"]);
        });
      });
      if(gradeRows.length){
        doc.autoTable({
          startY: y + 4,
          head: [["Subject","Category","Score","Max","Weight"]],
          body: gradeRows,
          theme:"striped", styles:{fontSize:9, cellPadding:4},
          headStyles:{fillColor:[45,45,55], textColor:255},
          margin:{left:margin, right:margin}
        });
        y = doc.lastAutoTable.finalY + 18;
      }
    }

    // Footer with page numbers
    const pageCount = doc.internal.getNumberOfPages();
    for(let p=1; p<=pageCount; p++){
      doc.setPage(p);
      doc.setFontSize(8); doc.setTextColor(150);
      doc.text("Page " + p + " of " + pageCount, pageW - margin, doc.internal.pageSize.getHeight() - 20, {align:"right"});
      doc.text("mySchedule", margin, doc.internal.pageSize.getHeight() - 20);
    }

    // Save PDF
    const fname = (state.profile.name || "my-coursework").toLowerCase().replace(/\s+/g,"-") + "-" + new Date().toISOString().slice(0,10) + ".pdf";
    doc.save(fname);
    toast("PDF exported.");
  }catch(err){
    console.error(err);
    toast(err.message || "Could not export PDF.");
  }
}

// Full JSON backup — transferable across devices
function exportData(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "coursework-backup.json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Backup exported. Save this JSON file to import on another device.");
}
function importData(file){
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{
      const parsed = JSON.parse(e.target.result);
      if(!parsed || typeof parsed !== "object" || (!parsed.subjects && !parsed.classes && !parsed.settings)){
        toast("This doesn't look like a mySchedule backup file.");
        return;
      }
      confirmModal("Restore backup? This will replace all current data on this device.", ()=>{
        state = deepMerge(defaultState(), parsed);
        saveState();
        applyAppearance();
        fillSettingsForm();
        renderAll();
        const counts = [];
        if(state.subjects?.length) counts.push(state.subjects.length + " subjects");
        if(state.classes?.length)  counts.push(state.classes.length + " classes");
        if(state.tasks?.length)    counts.push(state.tasks.length + " tasks");
        toast("Restored: " + (counts.join(", ") || "backup imported."));
      });
    }catch(err){
      toast("Import failed — invalid or corrupted JSON file.");
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
   AI IMAGE ANALYSIS — Claude Vision API
   ========================================================= */

/* =========================================================
   IMPROVED OCR-ONLY PARSER (no AI needed)
   Understands ICCT COR day codes: WSa MTh M W T F Sa
========================================================= */

// ICCT day code expansion: e.g. "WSa" -> ["Wednesday","Saturday"]
const ICCT_DAY_MAP = {
  "M":   ["Monday"],
  "T":   ["Tuesday"],
  "W":   ["Wednesday"],
  "Th":  ["Thursday"],
  "F":   ["Friday"],
  "Sa":  ["Saturday"],
  "S":   ["Saturday"],
  "Su":  ["Sunday"],
  "MT":  ["Monday","Tuesday"],
  "MW":  ["Monday","Wednesday"],
  "MF":  ["Monday","Friday"],
  "MTh": ["Monday","Thursday"],
  "TW":  ["Tuesday","Wednesday"],
  "TTh": ["Tuesday","Thursday"],
  "WF":  ["Wednesday","Friday"],
  "ThF": ["Thursday","Friday"],
  "MWF": ["Monday","Wednesday","Friday"],
  "TTh": ["Tuesday","Thursday"],
  "TThS":["Tuesday","Thursday","Saturday"],
  "WSa": ["Wednesday","Saturday"],
  "WS":  ["Wednesday","Saturday"],
  "MS":  ["Monday","Saturday"],
  "MSa": ["Monday","Saturday"],
  "TSa": ["Tuesday","Saturday"],
  "ThSa":["Thursday","Saturday"],
  "FSa": ["Friday","Saturday"]
};

function expandDayCodes(raw){
  // Try exact match first
  if(ICCT_DAY_MAP[raw]) return ICCT_DAY_MAP[raw];
  // Try uppercase
  const up = Object.keys(ICCT_DAY_MAP).find(k=>k.toUpperCase()===raw.toUpperCase());
  if(up) return ICCT_DAY_MAP[up];
  // Split known patterns greedily: WSa -> W + Sa, MTh -> M + Th
  const order = ["MTh","TTh","ThSa","TThS","MWF","WSa","MSa","TSa","FSa","WS","MS","TS","MW","MF","MT","TW","WF","ThF","Th","Sa","Su","Mo","Tu","We","Fr","M","T","W","F","S"];
  const days = [];
  let rem = raw;
  while(rem.length > 0){
    let matched = false;
    for(const key of order){
      if(rem.startsWith(key) && ICCT_DAY_MAP[key]){
        days.push(...ICCT_DAY_MAP[key]);
        rem = rem.slice(key.length);
        matched = true;
        break;
      }
    }
    if(!matched) break; // unknown remainder
  }
  return days.length ? days : null;
}

function parseTimeRange(str){
  // Matches: "06:00 AM - 07:30 AM", "07:30 AM-09:00 AM", "11:00 AM - 01:00 PM"
  const m = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[-–—to]+\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if(!m) return null;
  function to24(h, min, period){
    h = parseInt(h); min = parseInt(min);
    if(period){
      const p = period.toUpperCase();
      if(p==="PM" && h!==12) h+=12;
      if(p==="AM" && h===12) h=0;
    }
    return String(h).padStart(2,"0") + ":" + String(min).padStart(2,"0");
  }
  return {
    start: to24(m[1], m[2], m[3] || m[6]),
    end:   to24(m[4], m[5], m[6] || m[3])
  };
}

/**
 * Parses ICCT COR / schedule text (from OCR or PDF text extraction).
 * Handles the exact column layout: Course | Section | LecU | LabU | Days | Time | Room
 * Also handles simpler weekly schedule grid format.
 */
function parseScheduleText(rawText){
  const rows = [];
  const lines = rawText.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);

  // Regex tools
  const COR_DAY_RE = /\b(TThS|MWF|MTh|TTh|ThF|ThSa|WSa|MSa|TSa|FSa|MW|MF|MT|TW|WF|WS|MS|Th|Sa|Su|M|T|W|F|S)\b/;
  const TIME_RE    = /(\d{1,2}:\d{2}\s*(?:AM|PM)?\s*[-\u2013\u2014to]+\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)/i;
  const ROOM_RE    = /\b([A-Z]{1,4}\d[\w.\-]*|GYM|ZOOM|ONLINE)\b/;
  const COURSE_CODE_RE = /\b([A-Z]{2,8}-?\d{2,3}[A-Z]?)\b/;
  const DAY_HEADER_RE = /^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)$/i;

  function addRow(subject, day, time, room, type, instructor){
    if(!subject || !day || !time) return;
    rows.push({
      id: uid(), include: true,
      subject: subject.trim(),
      day, start: time.start, end: time.end,
      room: (room||"").trim(),
      type: type || "Face to Face",
      instructor: (instructor||"").trim()
    });
  }

  function detectType(text){
    const t = text.toUpperCase();
    if(t.includes("ZOOM")) return "Zoom";
    if(t.includes("GYM"))  return "Face to Face";
    if(t.includes("ONLINE")) return "Online";
    if(t.includes("FACE")) return "Face to Face";
    return "Face to Face";
  }

  // ============================================================
  // MODE 1: ICCT COR table format
  // Course code line → subject name line → (row with days + time + room)
  // Some rows have multiple times on 2 lines (LEC + LAB) — capture both
  // ============================================================
  let currentSubject = "";
  let currentCode    = "";
  let lastRowIdx     = -1;  // for detecting continuation LAB lines

  for(let i = 0; i < lines.length; i++){
    const line = lines[i];

    // Skip pure header lines
    if(/^(Course|Section|Lec\s*Units|Lab\s*Units|Days|Time and Date|Room|Total|Downpayment|Installment|TERM|AMOUNT|DUE DATE)/i.test(line)) continue;
    if(/^(Student|Full Name|Home Address|Academic|Contact|Program|Year Level|Sex|LRN)/i.test(line)) continue;

    // Course code detection: OLENG01, OLMATH01, OLFIL-01, OLSOFAPP, etc.
    const codeMatch = line.match(COURSE_CODE_RE);
    if(codeMatch && line.length < 80 && !TIME_RE.test(line) && !/LFAU/i.test(line)){
      currentCode = codeMatch[1];
      currentSubject = "";  // reset — next line likely has the full name
      // Try same line: the code may be followed by "Google Classroom" then subject on next line
      // Check if same line contains subject text after the code
      const afterCode = line.replace(codeMatch[1],"").replace(/Google\s+Classroom/i,"").trim();
      if(afterCode && afterCode.length > 3 && !/Gclass/i.test(afterCode)){
        currentSubject = afterCode;
      }
      continue;
    }

    // Subject name line (right after code, before Gclass Code)
    if(currentCode && !currentSubject &&
       !/Google\s+Classroom|Gclass\s+Code|LFAU|Section/i.test(line) &&
       /[A-Za-z]{4,}/.test(line) && line.length < 100 &&
       !COR_DAY_RE.test(line) && !TIME_RE.test(line)){
      currentSubject = line.trim();
      continue;
    }

    // Skip Gclass Code lines
    if(/Gclass\s*Code/i.test(line)) continue;

    // Data row: day code + time
    const dayMatch  = line.match(COR_DAY_RE);
    const timeMatch = line.match(TIME_RE);

    if(dayMatch && timeMatch){
      const days = expandDayCodes(dayMatch[1]);
      const time = parseTimeRange(timeMatch[1]);
      if(!days || !time) continue;

      const roomMatch = line.match(ROOM_RE);
      const room = roomMatch ? roomMatch[1] : "";
      const type = detectType(line);
      const name = currentSubject || currentCode || "Unknown Subject";

      lastRowIdx = rows.length;
      days.forEach(day=>addRow(name, day, time, room, type, ""));
      continue;
    }

    // Continuation LAB line (time only, no day code — inherits days from prev row)
    if(timeMatch && !dayMatch && lastRowIdx >= 0){
      const time = parseTimeRange(timeMatch[1]);
      if(!time) continue;
      const roomMatch = line.match(ROOM_RE);
      const room = roomMatch ? roomMatch[1] : "";
      const type = detectType(line);
      // Get days from last batch of rows (same subject)
      const prevRow = rows[lastRowIdx];
      if(prevRow){
        // Find all rows from lastRowIdx to end that share the same subject batch
        const sameBatchDays = new Set();
        for(let k = lastRowIdx; k < rows.length; k++){
          if(rows[k].subject === prevRow.subject) sameBatchDays.add(rows[k].day);
        }
        sameBatchDays.forEach(day=>addRow(prevRow.subject, day, time, room, type, ""));
      }
      continue;
    }
  }

  // ============================================================
  // MODE 2: Weekly grid format — ALWAYS run this too (not just fallback)
  // Handles: MONDAY / TUESDAY / WEDNESDAY sections with time ranges under each
  // ============================================================
  let curDay = null;
  let pendingSubject = "";
  for(let i = 0; i < lines.length; i++){
    const line = lines[i];
    const dayHeaderMatch = line.match(DAY_HEADER_RE);
    if(dayHeaderMatch){
      curDay = dayHeaderMatch[1].charAt(0).toUpperCase() + dayHeaderMatch[1].slice(1).toLowerCase();
      pendingSubject = "";
      continue;
    }
    if(!curDay) continue;
    if(/^NO\s+CLASSES?$/i.test(line)){ continue; }

    const timeMatch = line.match(TIME_RE);
    if(timeMatch){
      const time = parseTimeRange(timeMatch[1]);
      if(!time) continue;

      const roomMatch = line.match(ROOM_RE);
      const room = roomMatch ? roomMatch[1] : "";
      const type = detectType(line);

      // Extract subject: strip time, room, type keywords
      let subj = line
        .replace(timeMatch[1],"")
        .replace(ROOM_RE,"")
        .replace(/ZOOM|FACE\s*TO\s*FACE|F2F|ONLINE|GYM|LEC|LAB/gi,"")
        .replace(/[\|\u2022•]/g," ")
        .replace(/\s+/g," ")
        .trim();

      // If line has no subject text, look at surrounding lines
      if(!subj || subj.length < 3){
        // Try previous line
        if(pendingSubject) subj = pendingSubject;
        else if(lines[i-1] && !TIME_RE.test(lines[i-1]) && !DAY_HEADER_RE.test(lines[i-1]) && lines[i-1].length > 3){
          subj = lines[i-1].trim();
        }
        // Try next line
        else if(lines[i+1] && !TIME_RE.test(lines[i+1]) && !DAY_HEADER_RE.test(lines[i+1]) && lines[i+1].length > 3){
          subj = lines[i+1].trim();
        }
      }
      if(!subj) subj = "Unknown Subject";
      pendingSubject = subj;

      addRow(subj, curDay, time, room, type, "");
    } else if(line.length > 3 && !/NO\s+CLASSES?/i.test(line) && !DAY_HEADER_RE.test(line)){
      // Buffer possible subject name for next time entry
      pendingSubject = line.trim();
    }
  }

  // ============================================================
  // Deduplicate — same day + start + subject prefix
  // ============================================================
  const seen = new Set();
  return rows.filter(r=>{
    const k = r.day + "|" + r.start + "|" + r.end + "|" + r.subject.toUpperCase().replace(/\s+/g,"").slice(0,20);
    if(seen.has(k)) return false;
    seen.add(k); return true;
  });
}

const AI_KEY_STORAGE   = "coursework.ai_key";
const AI_PROV_STORAGE  = "coursework.ai_provider";


// vision:true  = sends image/PDF directly to the API
// vision:false = text-only; runs Tesseract OCR first, sends extracted text
// free:true    = has a free tier (no credit card required for basic use)
const AI_PROVIDERS = {



/* ---- VISION PROVIDERS (can read images/PDF directly) ---- */

  gemini: {
    label: "Google Gemini 2.0 Flash [FREE]",
    vision: true, free: true,
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    buildRequest(key, systemPrompt, userPrompt, base64Data, mediaType){
      const part = mediaType === "application/pdf"
        ? { inline_data:{ mime_type:"application/pdf", data: base64Data } }
        : { inline_data:{ mime_type: mediaType, data: base64Data } };
      return {
        url: this.endpoint + "?key=" + key,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts:[{ text: systemPrompt }] },
          contents:[{ parts:[ part, { text: userPrompt } ]}]
        })
      };
    },
    extractText(data){ return (data.candidates?.[0]?.content?.parts?.[0]?.text||"").trim(); }
  },

  groq_vision: {
    label: "Groq LLaMA 4 Scout Vision [FREE]",
    vision: true, free: true,
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    buildRequest(key, systemPrompt, userPrompt, base64Data, mediaType){
      // Groq vision does not support PDF — fall back to text prompt for PDF
      const userContent = mediaType === "application/pdf"
        ? userPrompt + " (PDF provided as text — do your best)"
        : [
            { type:"image_url", image_url:{ url:"data:"+mediaType+";base64,"+base64Data } },
            { type:"text", text: userPrompt }
          ];
      return {
        url: this.endpoint,
        headers: { "Content-Type":"application/json", "Authorization":"Bearer "+key },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          max_tokens: 2000,
          messages: [
            { role:"system", content: systemPrompt },
            { role:"user", content: userContent }
          ]
        })
      };
    },
    extractText(data){ return ((data.choices||[])[0]?.message?.content||"").trim(); }
  },

  mistral_vision: {
    label: "Mistral Pixtral [FREE tier]",
    vision: true, free: true,
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    buildRequest(key, systemPrompt, userPrompt, base64Data, mediaType){
      const userContent = mediaType === "application/pdf"
        ? userPrompt
        : [
            { type:"image_url", image_url:{ url:"data:"+mediaType+";base64,"+base64Data } },
            { type:"text", text: userPrompt }
          ];
      return {
        url: this.endpoint,
        headers: { "Content-Type":"application/json", "Authorization":"Bearer "+key },
        body: JSON.stringify({
          model: "pixtral-12b-2409",
          max_tokens: 2000,
          messages: [
            { role:"system", content: systemPrompt },
            { role:"user", content: userContent }
          ]
        })
      };
    },
    extractText(data){ return ((data.choices||[])[0]?.message?.content||"").trim(); }
  },

  openrouter: {
    label: "OpenRouter — free models [FREE]",
    vision: true, free: true,
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    buildRequest(key, systemPrompt, userPrompt, base64Data, mediaType){
      const userContent = mediaType === "application/pdf"
        ? userPrompt
        : [
            { type:"image_url", image_url:{ url:"data:"+mediaType+";base64,"+base64Data } },
            { type:"text", text: userPrompt }
          ];
      return {
        url: this.endpoint,
        headers: {
          "Content-Type":"application/json",
          "Authorization":"Bearer "+key,
          "HTTP-Referer":"https://mySchedule.app",
          "X-Title":"mySchedule"
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-exp:free",
          max_tokens: 2000,
          messages: [
            { role:"system", content: systemPrompt },
            { role:"user", content: userContent }
          ]
        })
      };
    },
    extractText(data){ return ((data.choices||[])[0]?.message?.content||"").trim(); }
  },

  anthropic: {
    label: "Anthropic Claude (paid)",
    vision: true, free: false,
    endpoint: "https://api.anthropic.com/v1/messages",
    buildRequest(key, systemPrompt, userPrompt, base64Data, mediaType){
      const contentBlock = mediaType === "application/pdf"
        ? { type:"document", source:{ type:"base64", media_type:"application/pdf", data: base64Data } }
        : { type:"image", source:{ type:"base64", media_type: mediaType, data: base64Data } };
      return {
        url: this.endpoint,
        headers: {
          "Content-Type":"application/json",
          "x-api-key": key,
          "anthropic-version":"2023-06-01",
          "anthropic-dangerous-direct-browser-access":"true"
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role:"user", content:[ contentBlock, { type:"text", text: userPrompt } ]}]
        })
      };
    },
    extractText(data){ return (data.content||[]).map(b=>b.type==="text"?b.text:"").join("").trim(); }
  },

  openai: {
    label: "OpenAI GPT-4o (paid)",
    vision: true, free: false,
    endpoint: "https://api.openai.com/v1/chat/completions",
    buildRequest(key, systemPrompt, userPrompt, base64Data, mediaType){
      const userContent = mediaType === "application/pdf"
        ? userPrompt
        : [
            { type:"image_url", image_url:{ url:"data:"+mediaType+";base64,"+base64Data } },
            { type:"text", text: userPrompt }
          ];
      return {
        url: this.endpoint,
        headers: { "Content-Type":"application/json", "Authorization":"Bearer "+key },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 2000,
          messages: [{ role:"system", content: systemPrompt },{ role:"user", content: userContent }]
        })
      };
    },
    extractText(data){ return ((data.choices||[])[0]?.message?.content||"").trim(); }
  },

  /* ---- TEXT-ONLY PROVIDERS (OCR first, then parse) ---- */

  groq: {
    label: "Groq LLaMA 3.3 text-only [FREE] + OCR",
    vision: false, free: true,
    _models: ["llama-3.3-70b-versatile","llama3-70b-8192","gemma2-9b-it","mixtral-8x7b-32768"],
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    buildTextRequest(key, systemPrompt, ocrText, model){
      return {
        url: this.endpoint,
        headers: { "Content-Type":"application/json", "Authorization":"Bearer "+key },
        body: JSON.stringify({
          model: model || "llama-3.3-70b-versatile",
          max_tokens: 2000,
          messages: [
            { role:"system", content: systemPrompt },
            { role:"user", content: "Here is the raw text extracted from the image via OCR. Parse it and return the JSON as instructed.\n\n---\n" + ocrText }
          ]
        })
      };
    },
    extractText(data){ return ((data.choices||[])[0]?.message?.content||"").trim(); }
  },

  mistral: {
    label: "Mistral text-only [FREE] + OCR",
    vision: false, free: true,
    _models: ["open-mistral-nemo","open-mixtral-8x7b","mistral-small-latest"],
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    buildTextRequest(key, systemPrompt, ocrText, model){
      return {
        url: this.endpoint,
        headers: { "Content-Type":"application/json", "Authorization":"Bearer "+key },
        body: JSON.stringify({
          model: model || "open-mistral-nemo",
          max_tokens: 2000,
          messages: [
            { role:"system", content: systemPrompt },
            { role:"user", content: "Here is the raw text extracted from the image via OCR. Parse it and return the JSON as instructed.\n\n---\n" + ocrText }
          ]
        })
      };
    },
    extractText(data){ return ((data.choices||[])[0]?.message?.content||"").trim(); }
  },

  cohere: {
    label: "Cohere Command R [FREE] + OCR",
    vision: false, free: true,
    endpoint: "https://api.cohere.com/v2/chat",
    buildTextRequest(key, systemPrompt, ocrText){
      return {
        url: this.endpoint,
        headers: { "Content-Type":"application/json", "Authorization":"Bearer "+key },
        body: JSON.stringify({
          model: "command-r-plus-08-2024",
          max_tokens: 2000,
          messages: [
            { role:"system", content: systemPrompt },
            { role:"user", content: "Here is the raw text extracted from the image via OCR. Parse it and return the JSON as instructed.\n\n---\n" + ocrText }
          ]
        })
      };
    },
    extractText(data){
      const msg = data.message;
      if(!msg) return "";
      return (msg.content||[]).map(b=>b.type==="text"?b.text:"").join("").trim() || (msg.text||"").trim();
    }
  },

  huggingface: {
    label: "HuggingFace (Qwen2.5) [FREE] + OCR",
    vision: false, free: true,
    endpoint: "https://api-inference.huggingface.co/models/Qwen/Qwen2.5-72B-Instruct/v1/chat/completions",
    buildTextRequest(key, systemPrompt, ocrText){
      return {
        url: this.endpoint,
        headers: { "Content-Type":"application/json", "Authorization":"Bearer "+key },
        body: JSON.stringify({
          model: "Qwen/Qwen2.5-72B-Instruct",
          max_tokens: 2000,
          messages: [
            { role:"system", content: systemPrompt },
            { role:"user", content: "Here is the raw text extracted from the image via OCR. Parse it and return the JSON as instructed.\n\n---\n" + ocrText }
          ]
        })
      };
    },
    extractText(data){ return ((data.choices||[])[0]?.message?.content||"").trim(); }
  }

};

function getProvider(){ return localStorage.getItem(AI_PROV_STORAGE) || "anthropic"; }
function saveProvider(p){ localStorage.setItem(AI_PROV_STORAGE, p); }
function getApiKey(){ return localStorage.getItem(AI_KEY_STORAGE) || ""; }
function saveApiKey(key){ localStorage.setItem(AI_KEY_STORAGE, key.trim()); }

function promptForApiKey(){
  return new Promise((resolve, reject)=>{
    const existingKey = getApiKey();
    const existingProv = getProvider();

    const PROVIDER_LINKS = {
      gemini: "https://aistudio.google.com/apikey",
      groq_vision: "https://console.groq.com/keys",
      groq: "https://console.groq.com/keys",
      mistral_vision: "https://console.mistral.ai/",
      mistral: "https://console.mistral.ai/",
      openrouter: "https://openrouter.ai/keys",
      cohere: "https://dashboard.cohere.com/api-keys",
      huggingface: "https://huggingface.co/settings/tokens",
      anthropic: "https://console.anthropic.com/",
      openai: "https://platform.openai.com/api-keys"
    };

    const providerSelect = el("select", {style:"width:100%;padding:6px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.9rem;"});
    Object.entries(AI_PROVIDERS).forEach(([k,v])=>{
      const opt = el("option", {value:k}, [v.label]);
      if(k === existingProv) opt.selected = true;
      providerSelect.appendChild(opt);
    });

    const keyLink = el("a", {href:"#", target:"_blank", class:"small", style:"display:block;margin-top:4px;"}, ["Get free API key"]);
    function updateLink(){
      const url = PROVIDER_LINKS[providerSelect.value] || "#";
      keyLink.href = url;
      keyLink.textContent = "Get free API key ↗ " + (providerSelect.options[providerSelect.selectedIndex]||{}).text;
    }
    providerSelect.addEventListener("change", updateLink);
    updateLink();

    const keyInput = input("password", existingKey, "Paste your API key here...");
    keyInput.style.fontFamily = "monospace";
    keyInput.style.fontSize = "0.85rem";

    const body = el("div", {}, [
      el("p", {class:"small"}, ["Pick a provider (prefer ones marked [FREE]) then paste your key. Keys stay in your browser only."]),
      field("AI Provider", providerSelect),
      keyLink,
      field("API Key", keyInput),
      el("div", {class:"modal-actions"}, [
        el("button", {class:"btn btn-ghost", onclick:()=>{ closeModal(); reject(new Error("cancelled")); }}, ["Cancel"]),
        el("div", {class:"modal-actions-right"}, [
          el("button", {class:"btn btn-primary", onclick:()=>{
            const k = keyInput.value.trim();
            if(!k){ toast("Please enter an API key."); return; }
            saveProvider(providerSelect.value);
            saveApiKey(k);
            closeModal();
            resolve(k);
          }}, ["Save & Continue"])
        ])
      ])
    ]);
    openModal("Set AI API Key", body);
  });
}

async function requireApiKey(){
  const key = getApiKey();
  if(key) return key;
  // Don't auto-prompt — throw so caller can fallback to local processing
  throw new Error("NO_API_KEY");
}

/* =========================================================
   PDF TEXT EXTRACTION via PDF.js (no API needed)
========================================================= */
let _pdfjsLoading = null;
function loadPdfJs(){
  if(window.pdfjsLib) return Promise.resolve();
  if(_pdfjsLoading) return _pdfjsLoading;
  _pdfjsLoading = new Promise((resolve, reject)=>{
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
    s.onload = ()=>{
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
      resolve();
    };
    s.onerror = ()=>reject(new Error("Could not load PDF reader."));
    document.head.appendChild(s);
  });
  return _pdfjsLoading;
}

async function extractTextFromPdf(base64Data, onProgress){
  await loadPdfJs();
  const binary = atob(base64Data);
  const bytes  = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  const pdf   = await window.pdfjsLib.getDocument({ data: bytes }).promise;
  let fullText = "";
  for(let p=1; p<=pdf.numPages; p++){
    if(onProgress) onProgress(Math.round((p/pdf.numPages)*100));
    const page  = await pdf.getPage(p);
    const tc    = await page.getTextContent();
    // Preserve line structure by grouping items by Y position
    const byY = {};
    tc.items.forEach(item=>{
      const y = Math.round(item.transform[5]);
      if(!byY[y]) byY[y]=[];
      byY[y].push(item.str);
    });
    const sorted = Object.keys(byY).sort((a,b)=>Number(b)-Number(a));
    sorted.forEach(y=>{ fullText += byY[y].join(" ") + "\n"; });
    fullText += "\n";
  }
  return fullText;
}

/* Lazy-load Tesseract only when needed for text-only providers */
let _tesseractLoading = null;
function loadTesseract(){
  if(window.Tesseract) return Promise.resolve();
  if(_tesseractLoading) return _tesseractLoading;
  _tesseractLoading = new Promise((resolve, reject)=>{
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = resolve;
    s.onerror = ()=>reject(new Error("Could not load OCR engine. Check your connection."));
    document.head.appendChild(s);
  });
  return _tesseractLoading;
}

async function runOCR(base64Data, mediaType, onProgress){
  await loadTesseract();
  const dataUrl = "data:" + mediaType + ";base64," + base64Data;
  const { data } = await window.Tesseract.recognize(dataUrl, "eng", {
    logger: (m)=>{ if(m.status==="recognizing text" && onProgress) onProgress(Math.round(m.progress*100)); }
  });
  return data.text || "";
}

async function callProviderAPI(provider, key, systemPrompt, userPrompt, base64Data, mediaType){
  const req = provider.buildRequest(key, systemPrompt, userPrompt, base64Data, mediaType);
  const response = await fetch(req.url, { method:"POST", headers:req.headers, body:req.body });
  if(!response.ok){
    const err = await response.json().catch(()=>({}));
    const msg = err?.error?.message || ("API error " + response.status);
    if(response.status === 401 || response.status === 403){ saveApiKey(""); throw new Error("Invalid API key. Tap the key button to update it."); }
    throw new Error(msg);
  }
  return provider.extractText(await response.json());
}

async function analyzeImageWithClaude(base64Data, mediaType, systemPrompt, userPrompt, progressCallback){
  const key = await requireApiKey();
  const provKey = getProvider();
  const provider = AI_PROVIDERS[provKey] || AI_PROVIDERS.anthropic;

  // Text-only providers: run OCR first, then send extracted text to the LLM
  if(!provider.vision){
    if(progressCallback) progressCallback(15, "Running OCR on image...");
    let ocrText = "";
    if(mediaType === "application/pdf"){
      if(progressCallback) progressCallback(15, "Extracting PDF text...");
      ocrText = await extractTextFromPdf(base64Data, pct=>{
        if(progressCallback) progressCallback(15+Math.round(pct*0.5), "Reading PDF... "+pct+"%");
      });
    } else {
      ocrText = await runOCR(base64Data, mediaType, (pct)=>{
        if(progressCallback) progressCallback(15 + Math.round(pct * 0.5), "Reading image... " + pct + "%");
      });
    }
    if(!ocrText.trim()) throw new Error("No text found. Try a clearer image or different file.");
    if(progressCallback) progressCallback(70, "Sending text to " + provider.label + "...");
    const models = provider._models || [null];
    let lastErr2 = null;
    for(const model of models){
      const req2 = provider.buildTextRequest(key, systemPrompt, ocrText, model);
      const r2 = await fetch(req2.url, { method:"POST", headers:req2.headers, body:req2.body });
      if(r2.ok) return provider.extractText(await r2.json());
      const e2 = await r2.json().catch(()=>({}));
      const m2 = e2?.error?.message || ("API error " + r2.status);
      if(r2.status === 401 || r2.status === 403){ saveApiKey(""); throw new Error("Invalid API key. Tap the key button to update it."); }
      lastErr2 = new Error(m2);
      if(r2.status === 404 || (m2 && m2.toLowerCase().includes("does not exist"))) continue;
      throw lastErr2;
    }
    throw lastErr2 || new Error("All Groq models failed.");
    const response = await fetch(req.url, { method:"POST", headers:req.headers, body:req.body });
    if(!response.ok){
      const err = await response.json().catch(()=>({}));
      const msg = err?.error?.message || ("API error " + response.status);
      if(response.status === 401 || response.status === 403){ saveApiKey(""); throw new Error("Invalid API key. Tap the key button to update it."); }
      throw new Error(msg);
    }
    return provider.extractText(await response.json());
  }

  // Vision-capable providers: send image directly
  if(progressCallback) progressCallback(30, "Sending image to " + provider.label + "...");
  return callProviderAPI(provider, key, systemPrompt, userPrompt, base64Data, mediaType);
}

function readFileAsBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      const dataUrl = e.target.result;
      const [header, base64] = dataUrl.split(",");
      const mediaType = (header.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
      resolve({ base64, mediaType, dataUrl, isPdf: mediaType === "application/pdf" });
    };
    reader.onerror = ()=>reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------
   SCHEDULE PARSING — AI-powered
--------------------------------------------------------- */

const SCHEDULE_SYSTEM_PROMPT = `You are an expert at reading Filipino college/university class schedule images (including printed COR, enrollment forms, and digital schedule screenshots).
Extract all class schedule entries and return ONLY a valid JSON array, no markdown, no explanation, no extra text.

Each entry must have exactly these fields:
{
  "subject": "Full subject name",
  "day": "Monday" or "Tuesday" or "Wednesday" or "Thursday" or "Friday" or "Saturday" or "Sunday",
  "start": "HH:MM in 24-hour format",
  "end": "HH:MM in 24-hour format",
  "room": "room code or empty string",
  "type": "Face to Face" or "Zoom" or "Online" or "Other",
  "instructor": "instructor name or empty string"
}

Important rules:
- Convert all times to 24-hour (e.g. 7:30 AM becomes 07:30, 1:00 PM becomes 13:00)
- If a subject meets on multiple days, create one entry per day
- Expand day abbreviations: M=Monday, T=Tuesday, W=Wednesday, TH/Th=Thursday, F=Friday, S/Sa=Saturday
- If modality is not shown, default to "Face to Face"
- Return [] if no schedule data is found
- Return ONLY the raw JSON array`;

async function parseScheduleWithAI(base64Data, mediaType, progressCallback){
  const rawJson = await analyzeImageWithClaude(
    base64Data, mediaType,
    SCHEDULE_SYSTEM_PROMPT,
    "Extract all class schedule entries from this image. Return ONLY a JSON array.",
    progressCallback
  );

  let parsed;
  try{
    const clean = rawJson.replace(/```json|```/gi,"").trim();
    parsed = JSON.parse(clean);
  }catch(e){
    throw new Error("AI returned an unexpected format. Try a clearer image.");
  }

  if(!Array.isArray(parsed)) throw new Error("AI returned an unexpected format.");

  return parsed.map(r=>({
    id: uid(),
    include: true,
    subject: String(r.subject||"").trim(),
    day: normalizeDay(String(r.day||"")),
    start: normalizeTime(String(r.start||"08:00")),
    end: normalizeTime(String(r.end||"09:00")),
    room: String(r.room||"").trim(),
    type: normalizeClassType(String(r.type||"")),
    instructor: String(r.instructor||"").trim()
  })).filter(r=> r.subject && r.day && r.start && r.end);
}

function normalizeDay(d){
  const map = {
    monday:"Monday", tuesday:"Tuesday", wednesday:"Wednesday",
    thursday:"Thursday", friday:"Friday", saturday:"Saturday", sunday:"Sunday"
  };
  return map[d.toLowerCase()] || d;
}
function normalizeTime(t){
  if(/^\d{1,2}:\d{2}$/.test(t)){
    const [h,m] = t.split(":").map(Number);
    return String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0");
  }
  return t;
}
function normalizeClassType(t){
  const tl = t.toLowerCase();
  if(tl.includes("zoom") || tl.includes("google meet") || tl.includes("gmeet")) return "Zoom";
  if(tl.includes("online")) return "Online";
  if(tl.includes("face")) return "Face to Face";
  return state.settings.defaultClassType;
}

/* ---------------------------------------------------------
   GRADE SCANNING — AI-powered
--------------------------------------------------------- */

const GRADE_SYSTEM_PROMPT = `You are an expert at reading Filipino college/university grade sheets, report cards, and transcript images (including COR grades, class record screenshots, and grade printouts).
Extract all grade entries and return ONLY a valid JSON array, no markdown, no explanation.

Each entry must have:
{
  "subject": "Full subject name",
  "score": (number — the actual grade/score value),
  "max": (number — maximum possible, usually 100),
  "category": "Quiz" or "Exam" or "Assignment" or "Activity" or "Project" or "Attendance" or "Final Grade" or "Other",
  "weight": (number — percentage weight if shown, else 0)
}

Rules:
- For final grade report cards: set category to "Final Grade", score = the grade, max = 100
- Prelim/Midterm/Finals grades → category = "Exam"
- If weight column is absent, set weight = 0
- Return [] if nothing found
- Return ONLY the raw JSON array`;

async function parseGradesWithAI(base64Data, mediaType, progressCallback){
  const rawJson = await analyzeImageWithClaude(
    base64Data, mediaType,
    GRADE_SYSTEM_PROMPT,
    "Extract all grade entries from this image. Return ONLY a JSON array.",
    progressCallback
  );

  let parsed;
  try{
    const clean = rawJson.replace(/```json|```/gi,"").trim();
    parsed = JSON.parse(clean);
  }catch(e){
    throw new Error("AI returned an unexpected format. Try a clearer image.");
  }

  if(!Array.isArray(parsed)) throw new Error("AI returned unexpected format.");
  return parsed.map(r=>({
    subject: String(r.subject||"").trim(),
    score: Number(r.score)||0,
    max: Number(r.max)||100,
    category: String(r.category||"Other").trim(),
    weight: Number(r.weight)||0
  })).filter(r=>r.subject);
}

/* ---------------------------------------------------------
   SUBJECT SCANNING — AI-powered
--------------------------------------------------------- */

const SUBJECT_SYSTEM_PROMPT = `You are an expert at reading Filipino college enrollment forms, class cards, and COR (Certificate of Registration) images.
Extract all subjects/courses listed and return ONLY a valid JSON array, no markdown, no explanation.

Each entry:
{
  "name": "Full subject name",
  "code": "Subject code like IT101 or empty string",
  "instructor": "Instructor name or empty string",
  "room": "Room or empty string",
  "schedule": "Schedule text or empty string (e.g. MWF 7:30-9:00 AM)"
}

Return ONLY the raw JSON array.`;

async function parseSubjectsWithAI(base64Data, mediaType, progressCallback){
  const rawJson = await analyzeImageWithClaude(
    base64Data, mediaType,
    SUBJECT_SYSTEM_PROMPT,
    "Extract all subjects/courses from this enrollment form or class list. Return ONLY a JSON array.",
    progressCallback
  );
  let parsed;
  try{
    const clean = rawJson.replace(/```json|```/gi,"").trim();
    parsed = JSON.parse(clean);
  }catch(e){
    throw new Error("AI returned an unexpected format. Try a clearer image.");
  }
  if(!Array.isArray(parsed)) throw new Error("AI returned unexpected format.");
  return parsed.map(r=>({
    name: String(r.name||"").trim(),
    code: String(r.code||"").trim(),
    instructor: String(r.instructor||"").trim(),
    room: String(r.room||"").trim(),
    schedule: String(r.schedule||"").trim()
  })).filter(r=>r.name);
}
/* =========================================================
   AI-POWERED IMPORT MODALS
========================================================= */

function buildDropZone(labelText, subText){
  const fileInput = el("input", {type:"file", accept:"image/*,application/pdf", style:"display:none"});
  const dropZone = el("div", {class:"import-drop"}, [
    el("div", {class:"imp-icon"}, ["\u{1f4f7}"]),
    el("p", {}, [el("strong",{},["Click to upload"]), " or drag & drop"]),
    el("p", {class:"small muted"}, [labelText]),
    el("p", {class:"small muted"}, [subText || "Analyzed by Claude AI"]),
    fileInput
  ]);
  dropZone.addEventListener("click", (e)=>{ if(e.target!==fileInput) fileInput.click(); });
  ["dragover","dragenter"].forEach(evt=>dropZone.addEventListener(evt,(e)=>{ e.preventDefault(); dropZone.classList.add("dragover"); }));
  ["dragleave","drop"].forEach(evt=>dropZone.addEventListener(evt,(e)=>{ e.preventDefault(); dropZone.classList.remove("dragover"); }));
  const listeners = [];
  fileInput.addEventListener("change",(e)=>{ if(e.target.files[0]){ listeners.forEach(fn=>fn(e.target.files[0])); }});
  dropZone.addEventListener("drop",(e)=>{ if(e.dataTransfer.files[0]){ listeners.forEach(fn=>fn(e.dataTransfer.files[0])); }});
  return { dropZoneEl: dropZone, onFile: (fn)=>listeners.push(fn) };
}

function buildProgressEl(){
  const fill = el("div", {class:"import-progress-fill"});
  const label = el("div", {class:"import-progress-label"}, ["Analyzing..."]);
  const wrap = el("div", {class:"import-progress-wrap hidden"}, [
    el("div", {class:"import-progress-bar"}, [fill]),
    label
  ]);
  return {
    wrap,
    set(pct, msg){ fill.style.width=pct+"%"; if(msg) label.textContent=msg; },
    show(){ wrap.classList.remove("hidden"); },
    hide(){ wrap.classList.add("hidden"); }
  };
}

function makeApiKeyBtn(){
  return el("button", {
    class:"btn btn-outline btn-sm",
    style:"float:right;margin-bottom:8px;",
    onclick: ()=>{ promptForApiKey().then(()=>toast("API key saved.")).catch(()=>{}); }
  }, ["\uD83D\uDD11 API Key"]);
}

/* ------- SCHEDULE IMPORT ------- */
function openImportImageModal(){
  let extractedRows = [];
  const { dropZoneEl, onFile } = buildDropZone("Photo/screenshot of your class schedule or COR");
  const prog = buildProgressEl();
  const resultsWrap = el("div", {class:"hidden"});

  const body = el("div", {}, [makeApiKeyBtn(), dropZoneEl, prog.wrap, resultsWrap]);
  openModal("Import Schedule from Image \u2014 AI", body);

  onFile(async (file)=>{
    if(!file.type.startsWith("image/") && file.type !== "application/pdf"){ toast("Please choose an image or PDF file."); return; }
    dropZoneEl.innerHTML = "";
    let imgData;
    try{ imgData = await readFileAsBase64(file); }catch(e){ toast("Could not read file."); return; }
    if(imgData.isPdf){
      dropZoneEl.appendChild(el("div",{style:"padding:20px;text-align:center;"},[
        el("p",{style:"font-size:3rem;margin:0;"},["PDF"]),
        el("p",{class:"small muted"},[file.name])
      ]));
    } else {
      dropZoneEl.appendChild(el("img", {class:"import-preview", src:imgData.dataUrl}));
    }
    prog.show();
    try{
      if(getApiKey()){
        prog.set(10, "Sending to AI...");
        extractedRows = await parseScheduleWithAI(imgData.base64, imgData.mediaType, (pct,msg)=>prog.set(pct,msg));
      } else {
        // No API key — extract text locally then parse
        let rawText = "";
        if(imgData.isPdf){
          prog.set(10, "Reading PDF...");
          rawText = await extractTextFromPdf(imgData.base64, pct=>prog.set(10+Math.round(pct*0.7), "Reading PDF... "+pct+"%"));
        } else {
          prog.set(10, "Running OCR on image...");
          await loadTesseract();
          const dataUrl = "data:" + imgData.mediaType + ";base64," + imgData.base64;
          const { data } = await window.Tesseract.recognize(dataUrl, "eng", {
            logger: m=>{ if(m.status==="recognizing text") prog.set(10+Math.round(m.progress*70), "Reading... "+Math.round(m.progress*100)+"%"); }
          });
          rawText = data.text || "";
        }
        prog.set(85, "Parsing schedule...");
        extractedRows = parseScheduleText(rawText);
        if(extractedRows.length === 0) toast("Couldn't detect classes. Try adding a free API key for better results.");
      }
      prog.set(100, "Done!");
      setTimeout(()=>prog.hide(), 600);
      renderScheduleResults();
    }catch(err){
      if(err.message === "cancelled" || err.message === "NO_API_KEY"){ prog.hide(); return; }
      console.error(err);
      toast(err.message || "Analysis failed. Try a clearer image or PDF.");
      prog.hide();
    }
  });

  function makeRowEl(r){
    const tr = el("tr", {class: r.include ? "" : "row-excluded"});
    const chk = el("input", {type:"checkbox"}); chk.checked = r.include;
    chk.addEventListener("change", ()=>{ r.include=chk.checked; tr.classList.toggle("row-excluded",!r.include); });
    const subjInput = input("text", r.subject, "Subject name"); subjInput.addEventListener("input", ()=>r.subject=subjInput.value);
    const daySelect = select(DAYS, r.day); daySelect.addEventListener("change", ()=>r.day=daySelect.value);
    const startInput = input("time", r.start); startInput.addEventListener("input", ()=>r.start=startInput.value);
    const endInput = input("time", r.end); endInput.addEventListener("input", ()=>r.end=endInput.value);
    const typeSelect = select(state.settings.classTypes, r.type); typeSelect.addEventListener("change", ()=>r.type=typeSelect.value);
    const roomInput = input("text", r.room, "Room"); roomInput.addEventListener("input", ()=>r.room=roomInput.value);
    const removeBtn = el("button", {class:"import-row-remove", title:"Remove", onclick:()=>{
      extractedRows=extractedRows.filter(x=>x.id!==r.id); tr.remove();
    }}, ["\u2715"]);
    [chk,subjInput,daySelect,startInput,endInput,typeSelect,roomInput,removeBtn].forEach(c=>tr.appendChild(el("td",{},[c])));
    return tr;
  }

  function renderScheduleResults(){
    resultsWrap.innerHTML=""; resultsWrap.classList.remove("hidden");
    if(extractedRows.length===0){
      resultsWrap.appendChild(el("div",{class:"import-hint"},["Claude couldn't detect any classes. Try a clearer image, or add rows manually below."]));
    } else {
      resultsWrap.appendChild(el("p",{class:"import-hint"},[
        "Found " + extractedRows.length + " class" + (extractedRows.length===1?"":"es") + ". Review, edit if needed, then import."
      ]));
    }
    const table=el("table",{class:"import-table"});
    const thead=el("thead",{},[el("tr",{},[
      el("th",[]),el("th",{},["Subject"]),el("th",{},["Day"]),
      el("th",{},["Start"]),el("th",{},["End"]),el("th",{},["Type"]),el("th",{},["Room"]),el("th",[])
    ])]);
    const tbody=el("tbody");
    extractedRows.forEach(r=>tbody.appendChild(makeRowEl(r)));
    table.appendChild(thead); table.appendChild(tbody);
    resultsWrap.appendChild(el("div",{class:"import-table-wrap"},[table]));
    const addRowBtn=el("button",{class:"btn btn-outline import-add-row",onclick:()=>{
      const r={id:uid(),include:true,day:todayName(),subject:"",start:"08:00",end:"09:00",room:"",type:state.settings.defaultClassType,instructor:""};
      extractedRows.push(r); tbody.appendChild(makeRowEl(r));
    }},["+ Add row"]);
    resultsWrap.appendChild(addRowBtn);
    resultsWrap.appendChild(el("div",{class:"modal-actions"},[
      el("button",{class:"btn btn-ghost",onclick:closeModal},["Cancel"]),
      el("div",{class:"modal-actions-right"},[
        el("button",{class:"btn btn-primary",onclick:()=>{
          const toImport=extractedRows.filter(r=>r.include && r.subject.trim() && r.day && r.start && r.end);
          if(toImport.length===0){ toast("Nothing selected to import."); return; }
          let added=0;
          toImport.forEach(r=>{
            const name=r.subject.trim();
            let subj=state.subjects.find(s=>s.name.toLowerCase()===name.toLowerCase());
            if(!subj){
              subj={id:uid(),name,code:"",instructor:r.instructor||"",room:r.room.trim(),schedule:"",description:"",notes:"",priority:"Medium"};
              state.subjects.push(subj);
            } else {
              if(!subj.instructor && r.instructor) subj.instructor=r.instructor;
              if(!subj.room && r.room) subj.room=r.room.trim();
            }
            state.classes.push({
              id:uid(),subject:subj.id,day:r.day,start:r.start,end:r.end,
              location:r.room.trim(),type:r.type||state.settings.defaultClassType,
              instructor:r.instructor||"",room:r.room.trim(),notes:"Imported via AI"
            });
            added++;
          });
          saveState(); renderAll(); closeModal();
          toast("Imported " + added + " class" + (added===1?"":"es") + ".");
        }},["Import Selected"])
      ])
    ]));
  }
}

/* ------- GRADE IMPORT ------- */
function openImportGradeModal(){
  const { dropZoneEl, onFile } = buildDropZone("Photo of your grade sheet, report card, or class record");
  const prog = buildProgressEl();
  const resultsWrap = el("div", {class:"hidden"});

  const body = el("div", {}, [makeApiKeyBtn(), dropZoneEl, prog.wrap, resultsWrap]);
  openModal("Import Grades from Image \u2014 AI", body);

  onFile(async (file)=>{
    if(!file.type.startsWith("image/") && file.type !== "application/pdf"){ toast("Please choose an image or PDF file."); return; }
    dropZoneEl.innerHTML="";
    let imgData;
    try{ imgData=await readFileAsBase64(file); }catch(e){ toast("Could not read file."); return; }
    if(imgData.isPdf){
      dropZoneEl.appendChild(el("div",{style:"padding:20px;text-align:center;"},[
        el("p",{style:"font-size:3rem;margin:0;"},["PDF"]),
        el("p",{class:"small muted"},[file.name])
      ]));
    } else {
      dropZoneEl.appendChild(el("img",{class:"import-preview",src:imgData.dataUrl}));
    }
    prog.show();
    let gradeRows=[];
    try{
      if(!getApiKey()){
        prog.hide();
        toast("Grade analysis needs an AI API key. Tap the API Key button (free options available).");
        return;
      }
      prog.set(20,"Sending to AI...");
      gradeRows=await parseGradesWithAI(imgData.base64,imgData.mediaType,(pct,msg)=>prog.set(pct,msg));
      prog.set(100,"Done!");
      setTimeout(()=>prog.hide(),600);
      renderGradeResults(gradeRows);
    }catch(err){
      if(err.message==="cancelled" || err.message==="NO_API_KEY"){ prog.hide(); return; }
      toast(err.message || "Grade analysis failed. Try a clearer image.");
      prog.hide();
    }
  });

  function renderGradeResults(rows){
    resultsWrap.innerHTML=""; resultsWrap.classList.remove("hidden");
    if(rows.length===0){
      resultsWrap.appendChild(el("div",{class:"import-hint"},["No grades detected. Try a clearer image."]));
      return;
    }
    resultsWrap.appendChild(el("p",{class:"import-hint"},[
      "Found " + rows.length + " grade entr" + (rows.length===1?"y":"ies") + ". Uncheck any you don't want, then import."
    ]));
    const table=el("table",{class:"import-table"});
    table.appendChild(el("thead",{},[el("tr",{},[
      el("th",[]),el("th",{},["Subject"]),el("th",{},["Category"]),
      el("th",{},["Score"]),el("th",{},["Max"]),el("th",{},["Weight %"])
    ])]));
    const tbody=el("tbody");
    const checks=rows.map(r=>{
      const cb=el("input",{type:"checkbox"}); cb.checked=true;
      const catSel=select(["Quiz","Exam","Assignment","Activity","Project","Attendance","Final Grade","Other"],r.category);
      catSel.addEventListener("change",()=>r.category=catSel.value);
      const scoreI=input("number",r.score); scoreI.min=0; scoreI.addEventListener("input",()=>r.score=Number(scoreI.value)||0);
      const maxI=input("number",r.max); maxI.min=0; maxI.addEventListener("input",()=>r.max=Number(maxI.value)||0);
      const wtI=input("number",r.weight); wtI.min=0; wtI.addEventListener("input",()=>r.weight=Number(wtI.value)||0);
      const tr=el("tr");
      [cb, document.createTextNode(r.subject), catSel, scoreI, maxI, wtI].forEach(c=>tr.appendChild(el("td",{},[c])));
      cb.addEventListener("change",()=>tr.classList.toggle("row-excluded",!cb.checked));
      tbody.appendChild(tr);
      return {r,cb};
    });
    table.appendChild(tbody);
    resultsWrap.appendChild(el("div",{class:"import-table-wrap"},[table]));
    resultsWrap.appendChild(el("div",{class:"modal-actions"},[
      el("button",{class:"btn btn-ghost",onclick:closeModal},["Cancel"]),
      el("div",{class:"modal-actions-right"},[
        el("button",{class:"btn btn-primary",onclick:()=>{
          const toImport=checks.filter(({cb})=>cb.checked).map(({r})=>r);
          if(toImport.length===0){ toast("Nothing selected."); return; }
          let added=0;
          toImport.forEach(r=>{
            let subj=state.subjects.find(s=>s.name.toLowerCase()===r.subject.toLowerCase());
            if(!subj){
              subj={id:uid(),name:r.subject,code:"",instructor:"",room:"",schedule:"",description:"",notes:"",priority:"Medium"};
              state.subjects.push(subj);
            }
            const rec=ensureGradeRecord(subj.id);
            rec.categories.push({id:uid(),name:r.category,score:r.score,max:r.max,weight:r.weight});
            added++;
          });
          saveState(); renderAll(); closeModal();
          toast("Imported " + added + " grade entr" + (added===1?"y":"ies") + ".");
          switchView("grades");
        }},["Import Grades"])
      ])
    ]));
  }
}

/* ------- SUBJECT IMPORT ------- */
function openImportSubjectModal(){
  const { dropZoneEl, onFile } = buildDropZone("Photo of your enrollment form, COR, or class list");
  const prog = buildProgressEl();
  const resultsWrap = el("div", {class:"hidden"});

  const body = el("div", {}, [makeApiKeyBtn(), dropZoneEl, prog.wrap, resultsWrap]);
  openModal("Import Subjects from Image \u2014 AI", body);

  onFile(async (file)=>{
    if(!file.type.startsWith("image/") && file.type !== "application/pdf"){ toast("Please choose an image or PDF file."); return; }
    dropZoneEl.innerHTML="";
    let imgData;
    try{ imgData=await readFileAsBase64(file); }catch(e){ toast("Could not read file."); return; }
    if(imgData.isPdf){
      dropZoneEl.appendChild(el("div",{style:"padding:20px;text-align:center;"},[
        el("p",{style:"font-size:3rem;margin:0;"},["PDF"]),
        el("p",{class:"small muted"},[file.name])
      ]));
    } else {
      dropZoneEl.appendChild(el("img",{class:"import-preview",src:imgData.dataUrl}));
    }
    prog.show();
    let subjRows=[];
    try{
      if(getApiKey()){
        prog.set(20,"Sending to AI...");
        subjRows=await parseSubjectsWithAI(imgData.base64,imgData.mediaType,(pct,msg)=>prog.set(pct,msg));
      } else {
        // No API key — extract locally then take unique subjects from schedule parser
        let rawText = "";
        if(imgData.isPdf){
          prog.set(10,"Reading PDF...");
          rawText = await extractTextFromPdf(imgData.base64, pct=>prog.set(10+Math.round(pct*0.7),"Reading PDF... "+pct+"%"));
        } else {
          prog.set(10,"Running OCR...");
          await loadTesseract();
          const dataUrl = "data:"+imgData.mediaType+";base64,"+imgData.base64;
          const { data } = await window.Tesseract.recognize(dataUrl,"eng",{
            logger: m=>{ if(m.status==="recognizing text") prog.set(10+Math.round(m.progress*65),"Reading... "+Math.round(m.progress*100)+"%"); }
          });
          rawText = data.text||"";
        }
        prog.set(85,"Extracting subjects...");
        const schedRows = parseScheduleText(rawText);
        const seen = new Set();
        subjRows = schedRows
          .filter(r=>{ const k = r.subject.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; })
          .map(r=>({ name:r.subject, code:"", instructor:r.instructor||"", room:r.room||"", schedule:"" }));
        if(subjRows.length===0) toast("Couldn't detect subjects. Try adding a free API key for better results.");
      }
      prog.set(100,"Done!");
      setTimeout(()=>prog.hide(),600);
      renderSubjectResults(subjRows);
    }catch(err){
      if(err.message==="cancelled" || err.message==="NO_API_KEY"){ prog.hide(); return; }
      toast(err.message || "Subject analysis failed. Try a clearer image.");
      prog.hide();
    }
  });

  function renderSubjectResults(rows){
    resultsWrap.innerHTML=""; resultsWrap.classList.remove("hidden");
    if(rows.length===0){
      resultsWrap.appendChild(el("div",{class:"import-hint"},["No subjects detected. Try a clearer image."])); return;
    }
    resultsWrap.appendChild(el("p",{class:"import-hint"},[
      "Found " + rows.length + " subject" + (rows.length===1?"":"s") + ". Edit if needed, then import."
    ]));
    const table=el("table",{class:"import-table"});
    table.appendChild(el("thead",{},[el("tr",{},[
      el("th",[]),el("th",{},["Subject Name"]),el("th",{},["Code"]),
      el("th",{},["Instructor"]),el("th",{},["Room"]),el("th",{},["Schedule"])
    ])]));
    const tbody=el("tbody");
    const checks=rows.map(r=>{
      const cb=el("input",{type:"checkbox"}); cb.checked=true;
      const nameI=input("text",r.name,"Subject name"); nameI.addEventListener("input",()=>r.name=nameI.value);
      const codeI=input("text",r.code,"Code"); codeI.addEventListener("input",()=>r.code=codeI.value);
      const instrI=input("text",r.instructor,"Instructor"); instrI.addEventListener("input",()=>r.instructor=instrI.value);
      const roomI=input("text",r.room,"Room"); roomI.addEventListener("input",()=>r.room=roomI.value);
      const schedI=input("text",r.schedule,"Schedule"); schedI.addEventListener("input",()=>r.schedule=schedI.value);
      const tr=el("tr");
      [cb,nameI,codeI,instrI,roomI,schedI].forEach(c=>tr.appendChild(el("td",{},[c])));
      cb.addEventListener("change",()=>tr.classList.toggle("row-excluded",!cb.checked));
      tbody.appendChild(tr);
      return {r,cb};
    });
    table.appendChild(tbody);
    resultsWrap.appendChild(el("div",{class:"import-table-wrap"},[table]));
    resultsWrap.appendChild(el("div",{class:"modal-actions"},[
      el("button",{class:"btn btn-ghost",onclick:closeModal},["Cancel"]),
      el("div",{class:"modal-actions-right"},[
        el("button",{class:"btn btn-primary",onclick:()=>{
          const toImport=checks.filter(({cb})=>cb.checked).map(({r})=>r).filter(r=>r.name.trim());
          if(toImport.length===0){ toast("Nothing selected."); return; }
          let added=0,skipped=0;
          toImport.forEach(r=>{
            const existing=state.subjects.find(s=>s.name.toLowerCase()===r.name.toLowerCase());
            if(existing){ skipped++; return; }
            state.subjects.push({id:uid(),name:r.name.trim(),code:r.code.trim(),instructor:r.instructor.trim(),room:r.room.trim(),schedule:r.schedule.trim(),description:"",notes:"",priority:"Medium"});
            added++;
          });
          saveState(); renderAll(); closeModal();
          toast("Added " + added + " subject" + (added===1?"":"s") + (skipped>0?" ("+skipped+" already existed)":"") + ".");
          switchView("subjects");
        }},["Import Subjects"])
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
    else if(action==="import-grade") openImportGradeModal();
    else if(action==="import-subject") openImportSubjectModal();
    else if(action==="set-api-key") promptForApiKey().then(()=>toast("API key saved.")).catch(()=>{});
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
  // Export = full JSON backup (transferable to other devices)
  // Export as PDF = printable summary (not restorable)
  const btnPdf = $("#btn-export-pdf");
  if(btnPdf) btnPdf.addEventListener("click", exportDataPdf);
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
