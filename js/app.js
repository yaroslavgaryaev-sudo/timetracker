/**
 * ВАЖНО (один раз в Supabase):
 * 1) В таблицу projects добавь колонку:
 *    group_name text null
 * 2) Таблица day_overrides должна существовать (как в предыдущей версии).
 */

const SUPABASE_URL = "https://jnynfpqneytabccplphc.supabase.co";
const SUPABASE_KEY = "sb_publishable_pYNWNHK7hKrTIJd0IzePuQ_uysAe1vd";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let session = null;
let userId = null;

let projects = []; // {id,name,group,budget,color,comment,paid,archived,createdAt}
let entries = {};  // key "date|slot" -> [pid1,pid2]
let showArchived = false;

const loadedDates = new Set();
const dayOverrides = new Map(); // dateISO -> is_premium boolean

// UI refs
const authStatus = document.getElementById("authStatus");
const loginBox = document.getElementById("loginBox");
const emailInput = document.getElementById("emailInput");
const btnSendLink = document.getElementById("btnSendLink");
const btnLogout = document.getElementById("btnLogout");
const loginHint = document.getElementById("loginHint");

function pad2(n){ return String(n).padStart(2,"0"); }
function toISODate(d){
  const x = new Date(d); x.setHours(0,0,0,0);
  return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
}
function fromISODate(s){
  const [y,m,d] = s.split("-").map(Number);
  const dt = new Date(y, m-1, d); dt.setHours(0,0,0,0);
  return dt;
}
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function daysBetween(a, b){
  const ms = 24*60*60*1000;
  const ax = new Date(a); ax.setHours(0,0,0,0);
  const bx = new Date(b); bx.setHours(0,0,0,0);
  return Math.round((bx-ax)/ms);
}
function fmtDayHeader(d){
  const opts = { weekday:"short", day:"2-digit", month:"2-digit", year:"numeric" };
  return d.toLocaleDateString("ru-RU", opts).replace(",", "");
}
function entryKey(dateISO, slot){ return `${dateISO}|${slot}`; }
function stableColorFromString(str){
  const palette = ["#6aa6ff","#66ffa6","#ffb86a","#ff6ad5","#a66aff","#6afff0","#ffd36a","#ff6a6a"];
  let h=0; for(let i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))>>>0;
  return palette[h % palette.length];
}

// Цвета проектов (ограниченный список)
const ALLOWED_PROJECT_COLORS = ["#FF0000", "#FF9300", "#FFFF00", "#00FF00", "#00AB49", "#FFFFFF", "#FF00FF", "#A800FF", "#3388EF", "#00FFFF", "#00C1C8", "#666666"];
function normalizeHexColor(v){
  if(!v) return null;
  let s = String(v).trim().toUpperCase();
  if(!s) return null;
  if(!s.startsWith('#')) s = '#' + s;
  if(!/^#[0-9A-F]{6}$/.test(s)) return null;
  return s;
}
function randomProjectColor(){
  return ALLOWED_PROJECT_COLORS[Math.floor(Math.random()*ALLOWED_PROJECT_COLORS.length)];
}

function slotToLabel(slotIndex){
  const mins = slotIndex * 30;
  const dayPlus = Math.floor(mins / 1440);
  const minsInDay = mins % 1440;
  const h = Math.floor(minsInDay/60);
  const m = minsInDay%60;
  const base = `${pad2(h)}:${pad2(m)}`;
  return dayPlus === 0 ? base : `${base} (+1)`;
}
function isWeekendISO(dateISO){
  const d = fromISODate(dateISO);
  const day = d.getDay();
  return (day === 0 || day === 6);
}
function getOverride(dateISO){
  return dayOverrides.has(dateISO) ? dayOverrides.get(dateISO) : null;
}
function isPremiumWholeDay(dateISO){
  const ov = getOverride(dateISO);
  if(ov === true) return true;
  if(ov === false) return false;
  return isWeekendISO(dateISO);
}
function slotMultiplier(dateISO, slotIndex){
  if(isPremiumWholeDay(dateISO)) return 1.5;
  const mins = (slotIndex * 30) % 1440;
  const hour = mins / 60;
  return (hour < 10 || hour >= 19) ? 1.5 : 1.0;
}
function projectById(id){ return projects.find(p=>p.id===id) || null; }
function isProjectSelectable(p){ return !!p && p.archived !== true; }

function getAllGroups(){
  const s = new Set();
  for(const p of projects){
    const g = (p.group || "").trim();
    if(g) s.add(g);
  }
  return Array.from(s).sort((a,b)=>a.localeCompare(b, "ru"));
}
function refreshGroupDatalists(){
  const list1 = document.getElementById("groupsDatalist");
  const list2 = document.getElementById("groupsDatalist2");
  const groups = getAllGroups();
  list1.innerHTML = "";
  list2.innerHTML = "";
  for(const g of groups){
    const o1 = document.createElement("option"); o1.value = g;
    const o2 = document.createElement("option"); o2.value = g;
    list1.appendChild(o1);
    list2.appendChild(o2);
  }
}

/** Auth */
async function refreshSession(){
  const { data, error } = await sb.auth.getSession();
  if(error){ console.error(error); setAuthed(null); return; }
  setAuthed(data.session);
}
function setAuthed(s){
  session = s;
  userId = s?.user?.id ?? null;
  if(userId){
    authStatus.textContent = `Вошёл: ${s.user.email}`;
    loginBox.classList.remove("open");
    btnLogout.style.display = "";
    bootAuthed().catch(console.error);
  } else {
    authStatus.textContent = "Не авторизован";
    loginBox.classList.add("open");
    btnLogout.style.display = "none";
    projects = [];
    entries = {};
    loadedDates.clear();
    dayOverrides.clear();
    renderAll(false);
  }
}
btnSendLink.addEventListener("click", async ()=>{
  const email = (emailInput.value || "").trim();
  if(!email){ alert("Введи e-mail."); return; }
  btnSendLink.disabled = true;
  loginHint.textContent = "Отправляю ссылку…";
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  btnSendLink.disabled = false;
  if(error){
    console.error("OTP error:", error);
    loginHint.textContent = "Ошибка отправки.";
    alert("Ошибка отправки: " + (error?.message || "Unknown error"));
  } else {
    loginHint.textContent = "Ссылка отправлена. Открой письмо и нажми на ссылку.";
  }
});
btnLogout.addEventListener("click", async ()=>{ await sb.auth.signOut(); setAuthed(null); });
sb.auth.onAuthStateChange((_event, s)=>{ setAuthed(s); });

/** Supabase data */
async function fetchProjects(){
  const { data, error } = await sb
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });
  if(error) throw error;
  projects = (data || []).map(p => ({
    id: p.id,
    name: p.name,
    group: p.group_name ?? "",
    color: normalizeHexColor(p.color_hex) || null,
    budget: Number(p.budget ?? 0),
    comment: p.comment ?? "",
    paid: !!p.paid,
    archived: !!p.archived,
    createdAt: new Date(p.created_at).getTime()
  }));
}
async function fetchEntriesForDates(dateList){
  const dates = dateList.filter(d => !loadedDates.has(d));
  if(dates.length === 0) return;
  dates.forEach(d => loadedDates.add(d));
  const { data, error } = await sb
    .from("calendar_entries")
    .select("date,slot,task_index,project_id")
    .in("date", dates);
  if(error){
    dates.forEach(d => loadedDates.delete(d));
    throw error;
  }
  for(const row of (data || [])){
    const k = entryKey(row.date, row.slot);
    if(!entries[k]) entries[k] = [];
    const idx = (row.task_index === 2) ? 1 : 0;
    entries[k][idx] = row.project_id;
  }
}
async function fetchDayOverridesForDates(dateList){
  const dates = dateList.filter(Boolean);
  if(!dates.length) return;
  const { data, error } = await sb
    .from("day_overrides")
    .select("date,is_premium")
    .in("date", dates);
  if(error) throw error;
  for(const d of dates) dayOverrides.delete(d);
  for(const row of (data || [])) dayOverrides.set(row.date, !!row.is_premium);
}
async function upsertDayOverride(dateISO, isPremium){
  const payload = { user_id: userId, date: dateISO, is_premium: !!isPremium };
  const { error } = await sb.from("day_overrides").upsert(payload, { onConflict: "user_id,date" });
  if(error) throw error;
  dayOverrides.set(dateISO, !!isPremium);
}
async function deleteDayOverride(dateISO){
  const { error } = await sb.from("day_overrides").delete().eq("date", dateISO);
  if(error) throw error;
  dayOverrides.delete(dateISO);
}
async function saveProjectToDb(p){
  const payload = {
    id: p.id,
    user_id: userId,
    name: p.name,
    group_name: (p.group || "").trim() || null,
    budget: p.budget,
    comment: p.comment,
    paid: p.paid,
    archived: p.archived,
    color_hex: normalizeHexColor(p.color) || null
  };
  const { error } = await sb.from("projects").upsert(payload, { onConflict: "id" });
  if(error) throw error;
}
async function deleteProjectFromDb(projectId){
  const { error: e1 } = await sb.from("projects").delete().eq("id", projectId);
  if(e1) throw e1;
  const { error: e2 } = await sb.from("calendar_entries").delete().eq("project_id", projectId);
  if(e2) console.warn(e2);
}
async function saveCellToDb(dateISO, slot, taskIds){
  const clean = (Array.isArray(taskIds) ? taskIds : [])
    .filter(Boolean)
    .filter((v,i,a)=>a.indexOf(v)===i)
    .slice(0,2);

  const { error: delErr } = await sb
    .from("calendar_entries")
    .delete()
    .eq("date", dateISO)
    .eq("slot", slot);
  if(delErr) throw delErr;

  if(clean.length > 0){
    const rows = clean.map((pid, i) => ({
      user_id: userId,
      date: dateISO,
      slot: slot,
      task_index: i+1,
      project_id: pid
    }));
    const { error: insErr } = await sb.from("calendar_entries").insert(rows);
    if(insErr) throw insErr;
  }

  const k = entryKey(dateISO, slot);
  if(clean.length === 0) delete entries[k];
  else entries[k] = clean;
}

/** Boot */
async function bootAuthed(){
  await fetchProjects();
  refreshGroupDatalists();
  rebuildColumns();
  await fetchEntriesForDates(columns.map(c=>c.iso));
  await fetchDayOverridesForDates(columns.map(c=>c.iso));
  renderAll(false);
  requestAnimationFrame(()=> centerToday());
}

/** Tabs */
document.querySelectorAll(".tabbtn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tabbtn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

/** Virtual calendar */
const ANCHOR_DATE = fromISODate("2026-01-01");
const DAY_COL = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--daycol"));
const SLOT_START = 18;      // 09:00
const SLOT_END_EXCL = 54;   // 03:00(+1)

let windowSize = 41;
let windowStartIndex = todayIndex() - Math.floor(windowSize/2);
function todayIndex(){ return daysBetween(ANCHOR_DATE, new Date()); }

let columns = [];
const leftBody    = document.getElementById("leftBody");
const hScroll     = document.getElementById("hScroll");
const rightHeader = document.getElementById("rightHeader");
const rightBody   = document.getElementById("rightBody");

function rebuildColumns(){
  columns = [];
  const tIdx = todayIndex();
  for(let i=0;i<windowSize;i++){
    const idx = windowStartIndex + i;
    const d = addDays(ANCHOR_DATE, idx);
    columns.push({ index: idx, date: d, iso: toISODate(d), isToday: idx===tIdx });
  }
}
function setTemplatesAndWidths(){
  rightHeader.style.gridTemplateColumns = `repeat(${columns.length}, var(--daycol))`;
  const w = Math.round(columns.length * DAY_COL);
  rightHeader.style.width = w + "px";
  rightBody.style.width   = w + "px";
}
function renderLeftTimes(){
  leftBody.innerHTML = "";
  for(let s=SLOT_START; s<SLOT_END_EXCL; s++){
    const t = document.createElement("div");
    t.className = "tcell mono";
    t.textContent = slotToLabel(s);
    leftBody.appendChild(t);
  }
}
function renderRightHeader(){
  rightHeader.innerHTML = "";
  for(const col of columns){
    const el = document.createElement("div");
    el.className = "hcell" + (col.isToday ? " today" : "");
    el.textContent = fmtDayHeader(col.date);
    const ov = getOverride(col.iso);
    if(ov === true) el.classList.add("userOff");
    if(ov === false) el.classList.add("userWork");

    el.style.cursor = "pointer";
    el.title = "Клик: сделать день рабочим/выходным";
    el.addEventListener("click", ()=> openDayModal(col.iso));
    rightHeader.appendChild(el);
  }
}
function renderCellPills(taskIds){
  const wrap = document.createElement("div");
  wrap.className = "cellPills";
  const ids = (Array.isArray(taskIds) ? taskIds : []).slice(0,2);

  for(const pid of ids){
    const p = projectById(pid);
    const name = p ? p.name : "— (проект удалён)";
    const color = (p && p.color) ? p.color : stableColorFromString(pid);
    const pill = document.createElement("div");
    pill.className = "pill small";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = color;
    const pn = document.createElement("span");
    pn.className = "pname";
    pn.textContent = name;
    pill.appendChild(dot);
    pill.appendChild(pn);
    wrap.appendChild(pill);
  }
  return wrap;
}
function getTasksForCell(dateISO, slot){
  const v = entries[entryKey(dateISO, slot)];
  if(Array.isArray(v)) return v.slice(0,2).filter(Boolean);
  return [];
}
function renderRightBody(){
  rightBody.innerHTML = "";
  for(let s=SLOT_START; s<SLOT_END_EXCL; s++){
    const row = document.createElement("div");
    row.className = "gRow";
    row.style.gridTemplateColumns = rightHeader.style.gridTemplateColumns;

    for(const col of columns){
      const tasks = getTasksForCell(col.iso, s);
      const mult = slotMultiplier(col.iso, s);

      const cell = document.createElement("div");
      cell.className = "cell" + (mult === 1.0 ? " normal" : " premium");

      if(tasks.length > 0) cell.appendChild(renderCellPills(tasks));
      cell.addEventListener("click", ()=> openCellModal(col.iso, s, tasks));
      row.appendChild(cell);
    }
    rightBody.appendChild(row);
  }
}

/* Vertical sync */
rightBody.addEventListener("scroll", ()=>{ leftBody.scrollTop = rightBody.scrollTop; });

/* Trackpad horizontal sync */
function forwardHorizontalWheel(e){
  if (Math.abs(e.deltaX) > 0) {
    hScroll.scrollLeft += e.deltaX;
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) e.preventDefault();
  }
}
rightBody.addEventListener("wheel", forwardHorizontalWheel, { passive: false });
leftBody.addEventListener("wheel", forwardHorizontalWheel, { passive: false });

/* Infinite scroll */
let scrollTicking = false;
hScroll.addEventListener("scroll", ()=>{
  if(scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(async ()=>{
    scrollTicking = false;

    const nearRight = (hScroll.scrollLeft + hScroll.clientWidth) > (hScroll.scrollWidth - DAY_COL*4);
    const nearLeft  = hScroll.scrollLeft < DAY_COL*2;

    if(nearRight || nearLeft){
      const shift = 10;
      const prev = hScroll.scrollLeft;

      windowStartIndex += nearRight ? shift : -shift;
      rebuildColumns();

      if(userId){
        try{
          await fetchEntriesForDates(columns.map(c=>c.iso));
          await fetchDayOverridesForDates(columns.map(c=>c.iso));
        } catch(e){ console.error(e); }
      }

      renderAll(true);

      hScroll.scrollLeft = nearRight
        ? Math.max(0, prev - shift*DAY_COL)
        : (prev + shift*DAY_COL);
    }
  });
});
function centerToday(){
  const tIdx = todayIndex();
  const left = windowStartIndex;
  const right = windowStartIndex + windowSize - 1;

  if(tIdx < left || tIdx > right){
    windowStartIndex = tIdx - Math.floor(windowSize/2);
    rebuildColumns();
    if(userId){
      Promise.all([
        fetchEntriesForDates(columns.map(c=>c.iso)),
        fetchDayOverridesForDates(columns.map(c=>c.iso))
      ]).then(()=> renderAll(true)).catch(console.error);
    } else {
      renderAll(true);
    }
  }
  const todayPos = tIdx - windowStartIndex;
  const targetCenter = todayPos * DAY_COL + DAY_COL/2;
  const desired = Math.max(0, targetCenter - (hScroll.clientWidth/2));
  hScroll.scrollLeft = desired;
}
document.getElementById("goToday").addEventListener("click", centerToday);

/** Modal: cell tasks */
const modalBackCell = document.getElementById("modalBackCell");
const modalCloseCell = document.getElementById("modalCloseCell");
const modalMetaCell = document.getElementById("modalMetaCell");
const modalHintCell = document.getElementById("modalHintCell");
const task1Select = document.getElementById("task1Select");
const task2Select = document.getElementById("task2Select");
const btnSaveCell = document.getElementById("saveCell");
const btnClearCell = document.getElementById("clearCell");
let modalCellState = { dateISO:null, slot:null };

function fillSelectWithProjects(sel, selectable, includeNone){
  sel.innerHTML = "";
  if(includeNone){
    const optNone = document.createElement("option");
    optNone.value = "";
    optNone.textContent = "— нет —";
    sel.appendChild(optNone);
  }
  for(const p of selectable){
    const opt = document.createElement("option");
    opt.value = p.id;
    const g = (p.group || "").trim();
    opt.textContent = g ? `${p.name}` : p.name;
    sel.appendChild(opt);
  }
}
function openCellModal(dateISO, slot, currentTasks){
  if(!userId){
    alert("Сначала войди по e-mail, чтобы сохранять данные в базе.");
    return;
  }
  modalCellState = { dateISO, slot };
  const mult = slotMultiplier(dateISO, slot);
  const tasks = (Array.isArray(currentTasks) ? currentTasks : []).slice(0,2);
  const isTwo = tasks.length === 2;

  modalMetaCell.textContent =
    `${dateISO} • ${slotToLabel(slot)} – ${slotToLabel(slot+1)} • x${mult} • ` +
    (isTwo ? `2 задачи по 0.25ч` : `1 задача 0.5ч`);

  const selectable = projects.filter(isProjectSelectable);

  if(selectable.length === 0){
    fillSelectWithProjects(task1Select, [], false);
    fillSelectWithProjects(task2Select, [], true);
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Нет доступных проектов (снимите 'Оплачено')";
    task1Select.appendChild(opt);
    task1Select.disabled = true;
    task2Select.disabled = true;
    btnSaveCell.disabled = true;
    modalHintCell.textContent = "Открой “Проекты” и сними “Оплачено” у проекта.";
  } else {
    task1Select.disabled = false;
    task2Select.disabled = false;
    btnSaveCell.disabled = false;

    fillSelectWithProjects(task1Select, selectable, false);
    fillSelectWithProjects(task2Select, selectable, true);

    const t1 = tasks[0] || selectable[0].id;
    const t2 = tasks[1] || "";

    if(selectable.some(p=>p.id===t1)) task1Select.value = t1;
    else task1Select.selectedIndex = 0;

    if(t2 && selectable.some(p=>p.id===t2)) task2Select.value = t2;
    else task2Select.value = "";

    modalHintCell.textContent = "Можно выбрать до 2 задач в одной ячейке.";
  }

  modalBackCell.classList.add("open");
  setTimeout(()=> task1Select.focus(), 0);
}
function closeCellModal(){ modalBackCell.classList.remove("open"); }
modalCloseCell.addEventListener("click", closeCellModal);
modalBackCell.addEventListener("click", (e)=>{ if(e.target === modalBackCell) closeCellModal(); });

btnSaveCell.addEventListener("click", async ()=>{
  const selectable = projects.filter(isProjectSelectable);
  if(selectable.length === 0) return;

  const t1 = task1Select.value;
  const t2 = task2Select.value;

  const next = [];
  if(t1) next.push(t1);
  if(t2) next.push(t2);

  try{
    await saveCellToDb(modalCellState.dateISO, modalCellState.slot, next);
    closeCellModal();
    renderAll(true);
  } catch(e){
    console.error(e);
    alert("Ошибка сохранения ячейки.");
  }
});
btnClearCell.addEventListener("click", async ()=>{
  try{
    await saveCellToDb(modalCellState.dateISO, modalCellState.slot, []);
    closeCellModal();
    renderAll(true);
  } catch(e){
    console.error(e);
    alert("Ошибка очистки ячейки.");
  }
});

/** Modal: day toggle */
const modalBackDay = document.getElementById("modalBackDay");
const modalCloseDay = document.getElementById("modalCloseDay");
const modalMetaDay = document.getElementById("modalMetaDay");
const modalExplainDay = document.getElementById("modalExplainDay");
const modalHintDay = document.getElementById("modalHintDay");
const btnResetDay = document.getElementById("resetDay");
const btnToggleDay = document.getElementById("toggleDay");
let modalDayState = { dateISO:null };

function openDayModal(dateISO){
  if(!userId){
    alert("Сначала войди по e-mail.");
    return;
  }
  modalDayState = { dateISO };

  const ov = getOverride(dateISO); // true/false/null
  const weekendDefault = isWeekendISO(dateISO);
  const effectivePremium = isPremiumWholeDay(dateISO);

  const curLabel = effectivePremium ? "Выходной (x1.5 весь день)" : "Рабочий (x1.5 только до 10:00 и с 19:00)";
  const baseLabel = weekendDefault ? "По умолчанию: выходной (сб/вс)" : "По умолчанию: рабочий";

  modalMetaDay.textContent = `${dateISO} • ${fmtDayHeader(fromISODate(dateISO))}`;
  modalExplainDay.textContent = `${baseLabel}. Сейчас: ${curLabel}.`;

  btnToggleDay.textContent = effectivePremium ? "Сделать рабочим" : "Сделать выходным";
  btnResetDay.disabled = (ov === null);
  modalHintDay.textContent = (ov === null)
    ? "Для этого дня нет переопределения."
    : "Сбросить — вернёт поведение “по умолчанию”.";

  modalBackDay.classList.add("open");
}
async function applyToggleDay(){
  const dateISO = modalDayState.dateISO;
  const weekendDefault = isWeekendISO(dateISO);
  const effectivePremium = isPremiumWholeDay(dateISO);
  const desired = !effectivePremium;
  const defaultPremium = weekendDefault;

  try{
    if(desired === defaultPremium){
      await deleteDayOverride(dateISO);
    } else {
      await upsertDayOverride(dateISO, desired);
    }
    await fetchDayOverridesForDates(columns.map(c=>c.iso));
    closeDayModal();
    renderAll(true);
  } catch(e){
    console.error(e);
    alert("Не получилось сохранить изменение дня.");
  }
}
async function applyResetDay(){
  const dateISO = modalDayState.dateISO;
  try{
    await deleteDayOverride(dateISO);
    await fetchDayOverridesForDates(columns.map(c=>c.iso));
    closeDayModal();
    renderAll(true);
  } catch(e){
    console.error(e);
    alert("Не получилось сбросить день.");
  }
}
function closeDayModal(){ modalBackDay.classList.remove("open"); }
modalCloseDay.addEventListener("click", closeDayModal);
modalBackDay.addEventListener("click", (e)=>{ if(e.target === modalBackDay) closeDayModal(); });
btnToggleDay.addEventListener("click", applyToggleDay);
btnResetDay.addEventListener("click", applyResetDay);

/** Modal: group edit */
const modalBackGroup = document.getElementById("modalBackGroup");
const modalCloseGroup = document.getElementById("modalCloseGroup");
const modalMetaGroup = document.getElementById("modalMetaGroup");
const groupInput = document.getElementById("groupInput");
const saveGroupBtn = document.getElementById("saveGroup");
let modalGroupState = { projectId:null };

function openGroupModal(projectId){
  const p = projectById(projectId);
  if(!p) return;

  modalGroupState = { projectId };
  modalMetaGroup.textContent = `Проект: ${p.name}`;
  groupInput.value = (p.group || "").trim();
  refreshGroupDatalists();

  modalBackGroup.classList.add("open");
  setTimeout(()=> groupInput.focus(), 0);
}
function closeGroupModal(){ modalBackGroup.classList.remove("open"); }
modalCloseGroup.addEventListener("click", closeGroupModal);
modalBackGroup.addEventListener("click", (e)=>{ if(e.target === modalBackGroup) closeGroupModal(); });
saveGroupBtn.addEventListener("click", async ()=>{
  const pid = modalGroupState.projectId;
  const p = projectById(pid);
  if(!p) return;

  p.group = (groupInput.value || "").trim();

  try{
    await saveProjectToDb(p);
    await fetchProjects();
    refreshGroupDatalists();
    closeGroupModal();
    renderAll(true);
  } catch(e){
    console.error(e);
    alert("Ошибка сохранения группы.");
  }
});

/** Esc closes any modal */
document.addEventListener("keydown", (e)=>{
  if(e.key !== "Escape") return;
  if(modalBackCell.classList.contains("open")) closeCellModal();
  if(modalBackDay.classList.contains("open")) closeDayModal();
  if(modalBackGroup.classList.contains("open")) closeGroupModal();
});

/** Projects */
const projGroup = document.getElementById("projGroup");
const projName = document.getElementById("projName");
const projBudget = document.getElementById("projBudget");
const addProjectBtn = document.getElementById("addProject");
const projectsTbody = document.getElementById("projectsTbody");
const toggleArchiveBtn = document.getElementById("toggleArchive");

function setArchiveButtonLabel(){
  toggleArchiveBtn.textContent = showArchived ? "Скрыть архивные" : "Показать архивные";
}
setArchiveButtonLabel();
toggleArchiveBtn.addEventListener("click", ()=>{
  showArchived = !showArchived;
  setArchiveButtonLabel();
  renderProjects();
});

addProjectBtn.addEventListener("click", async ()=>{
  if(!userId){ alert("Сначала войди по e-mail."); return; }

  const group = (projGroup.value || "").trim();
  const name = (projName.value || "").trim();
  const budget = Number(projBudget.value);

  if(!name){ alert("Введите название проекта."); return; }
  if(!Number.isFinite(budget) || budget < 0){ alert("Введите бюджет числом (0 или больше)."); return; }

  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "_" + Math.random().toString(16).slice(2);

  const p = { id, name, group, budget, color: randomProjectColor(), comment:"", paid:false, archived:false, createdAt: Date.now() };

  try{
    await saveProjectToDb(p);
    await fetchProjects();
    refreshGroupDatalists();
    projGroup.value = "";
    projName.value = "";
    projBudget.value = "";
    renderAll(true);
  } catch(e){
    console.error(e);
    alert("Ошибка сохранения проекта.");
  }
});
document.getElementById("recalc").addEventListener("click", ()=> renderAll(true));


// ===== Палитра выбора цвета проекта =====
let colorPickerEl = null;
function closeColorPicker(){
  if(colorPickerEl){
    colorPickerEl.remove();
    colorPickerEl = null;
  }
}
function openColorPicker(x, y, onPick){
  closeColorPicker();

  const wrap = document.createElement("div");
  wrap.className = "colorPicker";
  wrap.style.position = "fixed";
  wrap.style.left = Math.max(8, Math.min(window.innerWidth - 220, x)) + "px";
  wrap.style.top  = Math.max(8, Math.min(window.innerHeight - 120, y)) + "px";
  wrap.style.zIndex = "9999";
  wrap.style.padding = "10px";
  wrap.style.borderRadius = "12px";
  wrap.style.background = "rgba(20,20,24,0.98)";
  wrap.style.border = "1px solid rgba(255,255,255,0.12)";
  wrap.style.boxShadow = "0 10px 30px rgba(0,0,0,0.45)";

  const title = document.createElement("div");
  title.className = "muted";
  title.style.marginBottom = "8px";
  title.textContent = "Цвет проекта:";
  wrap.appendChild(title);

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(6, 26px)";
  grid.style.gap = "8px";

  for(const c of ALLOWED_PROJECT_COLORS){
    const b = document.createElement("button");
    b.type = "button";
    b.className = "colorSwatch";
    b.style.width = "26px";
    b.style.height = "26px";
    b.style.borderRadius = "8px";
    b.style.border = "1px solid rgba(255,255,255,0.18)";
    b.style.background = c;
    b.title = c;
    b.addEventListener("click", ()=>{
      closeColorPicker();
      onPick?.(c);
    });
    grid.appendChild(b);
  }
  wrap.appendChild(grid);

  const hint = document.createElement("div");
  hint.className = "muted";
  hint.style.marginTop = "8px";
  hint.style.fontSize = "12px";
  hint.textContent = "Esc или клик вне — закрыть";
  wrap.appendChild(hint);

  document.body.appendChild(wrap);
  colorPickerEl = wrap;

  // close on outside click / esc
  setTimeout(()=>{
    const onDoc = (e)=>{ if(colorPickerEl && !colorPickerEl.contains(e.target)) closeColorPicker(); };
    const onKey = (e)=>{ if(e.key === "Escape") closeColorPicker(); };
    document.addEventListener("mousedown", onDoc, { once: true });
    document.addEventListener("keydown", onKey, { once: true });
  }, 0);
}
function calcHoursByProject(){
  const acc = new Map();
  for(const k in entries){
    const taskIds = entries[k];
    if(!Array.isArray(taskIds) || taskIds.length === 0) continue;

    const parts = k.split("|");
    const dateISO = parts[0];
    const slot = Number(parts[1]);

    const mult = slotMultiplier(dateISO, slot);

    const n = Math.min(2, taskIds.length);
    const realPer = (n === 2) ? 0.25 : 0.5;
    const weightedPer = realPer * mult;

    for(let i=0;i<n;i++){
      const pid = taskIds[i];
      if(!pid) continue;
      const cur = acc.get(pid) || { real:0, weighted:0 };
      cur.real += realPer;
      cur.weighted += weightedPer;
      acc.set(pid, cur);
    }
  }
  return acc;
}

function renderProjects(){
  refreshGroupDatalists();

  const map = calcHoursByProject();
  projectsTbody.innerHTML = "";

  const visibleRows = projects.filter(p => showArchived ? true : p.archived !== true);

  if(visibleRows.length === 0){
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "muted";
    td.textContent = showArchived
      ? "Проектов нет."
      : "Нет неархивных проектов. Нажми “Показать архивные”.";
    tr.appendChild(td);
    projectsTbody.appendChild(tr);
    return;
  }

  for(const p of visibleRows){
    const hours = map.get(p.id) || { real:0, weighted:0 };
    const rate = hours.weighted > 0 ? (p.budget / hours.weighted) : null;

    const tr = document.createElement("tr");

    // Paid checkbox (no text)
    const tdPaid = document.createElement("td");
    const paidCb = document.createElement("input");
    paidCb.className = "ck";
    paidCb.type = "checkbox";
    paidCb.checked = !!p.paid;
    tdPaid.appendChild(paidCb);

    // Group (click -> modal)
    const tdGroup = document.createElement("td");
    const g = (p.group || "").trim();
    const gTag = document.createElement("span");
    gTag.className = "tag";
    gTag.style.cursor = "pointer";
    gTag.title = "Клик: изменить группу";
    gTag.textContent = g ? g : "—";
    gTag.addEventListener("click", ()=> openGroupModal(p.id));
    tdGroup.appendChild(gTag);

    // Project name (fixed width, wrap to 2 lines)
    const tdName = document.createElement("td");
    tdName.className = "nameCol";
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.alignItems = "flex-start";
    wrap.style.gap = "8px";

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = (p.color ? p.color : stableColorFromString(p.id));
    dot.style.marginTop = "4px";

    // клик по кружку — выбор цвета проекта
    dot.style.cursor = "pointer";
    dot.title = "Клик: изменить цвет";
    dot.addEventListener("click", (e)=>{
      e.stopPropagation();
      openColorPicker(e.clientX, e.clientY, async (hex)=>{
        const prev = p.color;
        p.color = normalizeHexColor(hex);
        try{
          await saveProjectToDb(p);
          await fetchProjects();
          refreshGroupDatalists();
          renderAll(true);
        } catch(err){
          console.error(err);
          alert("Ошибка сохранения цвета проекта.");
          p.color = prev;
        }
      });
    });

    const nameIn = document.createElement("input");
    nameIn.className = "input";
    nameIn.type = "text";
    nameIn.value = p.name;
    nameIn.style.width = "100%";

    // Enter = сохранить (через blur -> change)
    nameIn.addEventListener("keydown", (e)=>{
      if(e.key === "Enter"){
        e.preventDefault();
        nameIn.blur();
      }
    });

    nameIn.addEventListener("change", async ()=>{
      const v = (nameIn.value || "").trim();
      if(!v){
        nameIn.value = p.name;
        alert("Название проекта не может быть пустым.");
        return;
      }
      if(v === p.name) return;

      const prev = p.name;
      p.name = v;

      try{
        await saveProjectToDb(p);
        await fetchProjects();
        refreshGroupDatalists();
        renderAll(true);
      } catch(e){
        console.error(e);
        alert("Ошибка сохранения названия проекта.");
        p.name = prev;
        nameIn.value = prev;
      }
    });

    wrap.appendChild(dot);
    wrap.appendChild(nameIn);
    tdName.appendChild(wrap);

    // Hours (one column)
    const tdHours = document.createElement("td");
    tdHours.className = "mono";
    tdHours.textContent = `${hours.real.toFixed(2)} / ${hours.weighted.toFixed(2)}`;

    // Budget inline numeric input (no separate popup)
    const tdBudget = document.createElement("td");
    const bIn = document.createElement("input");
    bIn.className = "input mono";
    bIn.type = "number";
    bIn.min = "0";
    bIn.step = "0.01";
    bIn.value = Number(p.budget).toFixed(2);
    bIn.style.width = "120px";
    bIn.addEventListener("change", async ()=>{
      const v = Number(bIn.value);
      if(!Number.isFinite(v) || v < 0){
        bIn.value = Number(p.budget).toFixed(2);
        alert("Бюджет должен быть числом (0 или больше).");
        return;
      }
      p.budget = v;
      try{
        await saveProjectToDb(p);
        await fetchProjects();
        renderAll(true);
      } catch(e){
        console.error(e);
        alert("Ошибка сохранения бюджета.");
      }
    });
    tdBudget.appendChild(bIn);

    // Rate
    const tdRate = document.createElement("td");
    tdRate.className = "mono";
    tdRate.textContent = rate === null ? "—" : rate.toFixed(2);

    // Comment
    const tdComment = document.createElement("td");
    const ta = document.createElement("textarea");
    ta.className = "textarea";
    ta.placeholder = "Комментарий...";
    ta.value = p.comment || "";
    ta.addEventListener("input", async ()=>{
      p.comment = ta.value;
      try{ await saveProjectToDb(p); } catch(e){ console.error(e); }
    });
    tdComment.appendChild(ta);

    // Delete button "X"
    const tdActions = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "btn danger icon";
    delBtn.textContent = "✕";
    delBtn.title = "Удалить проект";
    delBtn.addEventListener("click", async ()=>{
      const ok = confirm(`Удалить проект "${p.name}"?\nЯчейки с этим проектом будут очищены.`);
      if(!ok) return;
      try{
        await deleteProjectFromDb(p.id);
        await fetchProjects();
        refreshGroupDatalists();

        for(const kk in entries){
          const arr = entries[kk];
          if(Array.isArray(arr) && arr.includes(p.id)){
            const rest = arr.filter(x=>x!==p.id);
            if(rest.length === 0) delete entries[kk];
            else entries[kk] = rest.slice(0,2);
          }
        }
        renderAll(true);
      } catch(e){
        console.error(e);
        alert("Ошибка удаления проекта.");
      }
    });
    tdActions.appendChild(delBtn);

    paidCb.addEventListener("change", async ()=>{
      p.paid = paidCb.checked;

      // "Оплачено" = убрать из основного списка -> отправить в архив
      p.archived = !!p.paid;

      try{
        await saveProjectToDb(p);
        await fetchProjects();
        refreshGroupDatalists();
        renderAll(true);
      } catch(e){
        console.error(e);
        alert("Ошибка сохранения проекта.");
      }
    });

    tr.appendChild(tdPaid);
    tr.appendChild(tdGroup);
    tr.appendChild(tdName);
    tr.appendChild(tdHours);
    tr.appendChild(tdBudget);
    tr.appendChild(tdRate);
    tr.appendChild(tdComment);
    tr.appendChild(tdActions);

    projectsTbody.appendChild(tr);
  }
}

/** Render all */
function renderAll(keepScroll){
  const savedV = keepScroll ? rightBody.scrollTop : 0;
  const savedH = keepScroll ? hScroll.scrollLeft : 0;

  rebuildColumns();
  setTemplatesAndWidths();
  renderLeftTimes();
  renderRightHeader();
  renderRightBody();
  renderProjects();

  if(keepScroll){
    rightBody.scrollTop = savedV;
    leftBody.scrollTop = savedV;
    hScroll.scrollLeft = savedH;
  }
}

/** Init */
renderAll(false);
refreshSession().catch(console.error);
