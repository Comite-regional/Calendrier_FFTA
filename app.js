// === Utilitaires ===
function safeText(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));
}
function parseFRDate(d){
  const s = String(d||"").trim();
  if(!s) return null;

  // ISO YYYY-MM-DD
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){
    const [y,m,dd]=s.split("-").map(Number);
    const dt = new Date(y, m-1, dd);
    return isNaN(dt) ? null : dt;
  }

  // FR DD/MM/YY ou DD/MM/YYYY
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if(m){
    const dd=Number(m[1]), mo=Number(m[2]);
    let y=Number(m[3]);
    if(y < 100) y += 2000;
    const dt = new Date(y, mo-1, dd);
    return isNaN(dt) ? null : dt;
  }

  const dt = new Date(s);
  return isNaN(dt) ? null : dt;
}
function fmtDateFR(d){
  const dt = (d instanceof Date) ? d : parseFRDate(d);
  if(!dt) return "";
  return dt.toLocaleDateString("fr-FR", { weekday:"short", day:"2-digit", month:"short", year:"numeric" });
}
function isoDate(d){
  const dt = (d instanceof Date) ? d : parseFRDate(d);
  if(!dt) return null;
  const y=dt.getFullYear();
  const m=String(dt.getMonth()+1).padStart(2,"0");
  const dd=String(dt.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function ymdCompact(d){
  const dt = (d instanceof Date) ? d : parseFRDate(d);
  if(!dt) return null;
  const y=String(dt.getFullYear());
  const m=String(dt.getMonth()+1).padStart(2,"0");
  const dd=String(dt.getDate()).padStart(2,"0");
  return `${y}${m}${dd}`;
}
function addDays(d, n){
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate()+n);
  return dt;
}
function today00(){
  const t = new Date(); t.setHours(0,0,0,0); return t;
}
function haversineKm(lat1, lon1, lat2, lon2){
  const R=6371;
  const toRad = x => x*Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function deptFromCodeStructure(code){
  const s = String(code||"").trim();
  if(!s) return "";
  // codes FFTA: 2 premiers chiffres = département (avec 97/98/99 DOM/TOM)
  const m = s.match(/^(\d{2,3})/);
  return m ? m[1].padStart(2,"0") : "";
}

// === Chargement CSV (robuste) ===
async function loadCSV(url){
  const res = await fetch(url, {cache:"no-store"});
  if(!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  const txt = await res.text();
  const lines = txt.replace(/\r/g,"").split("\n").filter(l=>l.trim().length);
  const headers = lines[0].split(";").map((h,i)=>{ h = (h||"").trim(); return h ? h : `__col${i}`; });
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const parts = lines[i].split(";");
    const row = {};
    for(let j=0;j<headers.length;j++){
      row[headers[j]] = (parts[j] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}
async function loadCSVAny(candidates){
  let lastErr = null;
  for(const u of candidates){
    try{ return await loadCSV(u); }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error("Aucun CSV trouvé");
}

// === Mapping disciplines -> clé couleur ===
function normalizeDisciplineLabel(s){
  return String(s||"").trim();
}
function discKeyFromLabel(label){
  const s = String(label||"").toLowerCase();

  // Concours "Jeunes" / "Loisirs"
  if(s.includes("jeune") || s.includes("poussin") || s.includes("u11") || s.includes("u13")) return "jeune";
  if(s.includes("loisir")) return "loisir";

  // Para
  if(s.includes("para")){
    if(s.includes("18") || s.includes("salle")) return "para18m";
    return "paraext";
  }

  // Campagne / 3D / Nature / Beursault
  if(s.includes("campagne")) return "campagne";
  if(s.includes("beursault")) return "beursault";
  if(s.includes("3d")) return "3d";
  if(s.includes("nature")) return "nature";

  // Salle 18m
  if(s.includes("18") || s.includes("salle")) return "18m";

  // Extérieur / TAE
  if(s.includes("extérieur") || s.includes("exterieur") || s.includes("tae") || s.includes("t.a.e")) return "tae";

  return "";
}

// Palette "adoucie" (liste + carte) - on reste cohérent avec styles.css (calendrier)
const DISC_STYLE = {
  tae:       { fill:"#f6ff00", stroke:"#202020", text:"#111111" },
  "18m":     { fill:"#f59e0b", stroke:"#111827", text:"#111111" },
  paraext:   { fill:"#f6ff00", stroke:"#202020", text:"#111111" },
  para18m:   { fill:"#c9d4ea", stroke:"#0b1b3a", text:"#111111" },
  "3d":      { fill:"#c08a5a", stroke:"#4a2f15", text:"#111111" },
  nature:    { fill:"#556b2f", stroke:"#2e3a19", text:"#111111" },
  beursault: { fill:"#000000", stroke:"#ffffff", text:"#ffffff", bi:true },
  campagne:  { fill:"#000000", stroke:"#f2c200", text:"#f2c200", bi:true },
  jeune:     { fill:"#e2d5ff", stroke:"#3a1c6b", text:"#111111" },
  loisir:    { fill:"#7dd3fc", stroke:"#073047", text:"#111111" }
};

// === État ===
let concoursRows = [];
let concoursList = [];     // objets "concours" (pour liste + carte)
let concoursEvents = [];   // objets FullCalendar
let datesCles = [];

let cal = null;

let nearby = { map:null, layer:null, user:null, radius:50, userMarker:null };
let currentDiscipline = "Toutes";
let currentDept = "Tous";
let queryText = "";

let allowedUids = null; // Set<string>

// === Initialisation ===
init();

function initTabs(){
  const tabs = [...document.querySelectorAll(".tab")];
  tabs.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      tabs.forEach(b=>b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const v = btn.dataset.view;
      document.querySelectorAll(".view").forEach(s=>s.classList.remove("is-active"));
      document.querySelector(v==="concours" ? "#view-concours" : "#view-dates").classList.add("is-active");
      // petit refresh map si besoin
      if(v==="concours" && nearby.map){ setTimeout(()=>nearby.map.invalidateSize(), 50); }
    });
  });
}

async function init(){
  initTabs();

  try{
    await Promise.all([loadConcours26(), loadDatesCles()]);
  }catch(err){
    console.error("Erreur chargement données:", err);
    const up = document.getElementById("upcoming");
    if(up) up.textContent = "Impossible de charger les CSV. Vérifie que concours26.csv et dates_cles.csv sont dans le même dossier que index.html (ou dans /data).";
    const tl = document.getElementById("timeline");
    if(tl) tl.textContent = "Impossible de charger dates_cles.csv.";
    return;
  }

  initFilters();
  initCalendar();
  initNearby();
  initModal();
  renderUpcoming();
  renderMarquee();
  renderTimeline();

  // Délégation clics "Ajouter au calendrier" (map popup / listes)
  document.addEventListener("click", (e)=>{
    const t = e.target;
    if(!(t instanceof Element)) return;
    const btn = t.closest("[data-ics-uid]");
    if(btn){
      e.preventDefault();
      const uid = btn.getAttribute("data-ics-uid");
      const c = concoursList.find(x=>x.uid===uid);
      if(c) downloadICSForConcours(c);
    }
  });
}

// === Chargement concours26.csv ===
async function loadConcours26(){
  const rows = await loadCSVAny(["concours26.csv","./concours26.csv","data/concours26.csv","assets/concours26.csv"]);
  concoursRows = rows;

  const t0 = today00();

  concoursList = rows.map((r, idx)=>{
    const title = (r["Titre compétition"] || r["Titre competition"] || r["Titre"] || "Concours").trim();
    const startD = parseFRDate(r["Date debut"] || r["Date début"] || r["Date Début"] || r["Date Debut"]);
    const endD = parseFRDate(r["Date fin"] || r["Date Fin"]);
    const start = startD || endD || null;
    const end = endD || startD || null;

    // discipline: demandé = colonne Discipline
    const discRaw = normalizeDisciplineLabel(r["Discipline"] || r["Discipline compétition"] || r["Discipline competition"] || "");
    const disc = discRaw || "";

    // dept
    const code_structure = String(r["Code structure"] || r["Code Structure"] || r["CODE_STRUCTURE"] || "").trim();
    const dept = String(r["Departement"] || r["Département"] || r["DEPARTEMENT"] || "").trim() || deptFromCodeStructure(code_structure);

    // ville / lieu
    const city = (r["Ville"] || r["Commune"] || r["Localité"] || "").trim();
    const cp = (r["Code postal"] || r["CP"] || "").trim();
    const lieu = (r["Lieu"] || r["Lieu tir"] || r["Lieu de tir"] || "").trim();

    // GPS : certains exports inversent Lat/Long
    const latRaw = String(r["Lat"] ?? "").replace(",", ".").trim();
    const lonRaw = String(r["Long"] ?? "").replace(",", ".").trim();
    let a = parseFloat(latRaw);
    let b = parseFloat(lonRaw);
    let lat = b, lon = a; // base
    // si a ressemble à une latitude (40..55) et b à une longitude (-6..10), on swap
    if(Number.isFinite(a) && Number.isFinite(b)){
      if(Math.abs(a) > 35 && Math.abs(a) < 60 && Math.abs(b) < 15){
        lat = a; lon = b;
      }else if(Math.abs(b) > 35 && Math.abs(b) < 60 && Math.abs(a) < 15){
        lat = b; lon = a;
      }
    }

    // Club organisateur
    const club = String(r["Club organisateur"] || r["Club"] || "").trim();

    // Contacts : emails et URLs présents dans la ligne
    const emails = [];
    const urls = [];
    for(const v of Object.values(r)){
      const s = String(v||"").trim();
      if(!s) continue;
      if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)){
        if(!emails.includes(s)) emails.push(s);
      }else if(/^https?:\/\//i.test(s)){
        if(!urls.includes(s)) urls.push(s);
      }
    }

    // mandat : colonne Mandat, sinon un lien qui ressemble à un PDF/mandat
    let mandat = String(r["Mandat"] || "").trim();
    if(!mandat){
      mandat = urls.find(u => /\.(pdf)(\?|#|$)/i.test(u) || /mandat/i.test(u) || /convocation/i.test(u)) || "";
    }

    // site web : premier lien http qui n'est pas le mandat (souvent site du club)
    let site = urls.find(u => u && u !== mandat) || "";
    // si "mandat" ressemble à un site (pas PDF), on le bascule en site web
    if(!site && mandat && !/\.(pdf)(\?|#|$)/i.test(mandat) && !/(mandat|convocation)/i.test(mandat)){
      site = mandat;
      mandat = "";
    }

    const mail = emails[0] || "";
    const mail2 = emails[1] || "";

    // UID stable (pour relier liste/map/calendrier)
    const uid = `${title}__${isoDate(start)||"na"}__${isoDate(end)||"na"}__${dept||"xx"}__${idx}`.replace(/\s+/g,"_");

    return { uid, title, disc, dept, start, end, city, cp, lieu, lat, lon, mandat, site, club, mail, mail2, code_structure };
  });

  // À venir : end >= aujourd'hui
  concoursList = concoursList.filter(c=>{
    const end = c.end || c.start;
    if(!end) return true;
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    return d >= t0;
  });

  // FullCalendar events
  concoursEvents = concoursList.map(c=>{
    const k = discKeyFromLabel(c.disc);
    const startIso = c.start ? isoDate(c.start) : null;
    // FullCalendar allDay: DTEND exclusive
    let endIso = null;
    if(c.end && c.start){
      const same = isoDate(c.end) === isoDate(c.start);
      if(!same) endIso = isoDate(addDays(c.end, 1));
    }
    const ev = {
      id: c.uid,
      title: c.title,
      start: startIso,
      end: endIso || undefined,
      allDay: true,
      classNames: k ? [`ev-${k}`] : [],
      extendedProps: {
        uid: c.uid,
        discipline: c.disc,
        dept: c.dept,
        lieu: (c.lieu || c.city || "").trim(),
        city: c.city,
        cp: c.cp,
        mandat: c.mandat,
        site: c.site,
        club: c.club,
        mail: c.mail,
        mail2: c.mail2,
        lat: c.lat,
        lon: c.lon
      }
    };
    return ev;
  });
}

// === Dates clés ===
async function loadDatesCles(){
  const rows = await loadCSVAny(["dates_cles.csv","./dates_cles.csv","data/dates_cles.csv","assets/dates_cles.csv"]);
  datesCles = rows.map(r=>{
    const start = parseFRDate(r["date_debut"] || r["Date debut"] || r["Date début"]);
    const end = parseFRDate(r["date_fin"] || r["Date fin"]) || start;
    return {
      type: (r["type"]||"").trim(),
      title: (r["titre"]||r["Titre"]||"").trim(),
      start,
      end,
      lieu: (r["lieu"]||"").trim(),
      precision: (r["precision"]||"").trim(),
      importance: (r["importance"]||"").trim(),
      mandat: (r["mandat"]||r["Mandat"]||r["lien_mandat"]||r["url_mandat"]||"").trim()
    };
  }).filter(x=>x.start)
    .filter(x=>{
      const t = today00();
      const endD = new Date(x.end); endD.setHours(23,59,59,999);
      return endD >= t;
    });
}

// === Filtres ===
function initFilters(){
  const sel = document.getElementById("discipline");
  const selDept = document.getElementById("dept");
  const q = document.getElementById("q");

  // Discipline = valeurs uniques de la colonne Discipline
  const discSet = new Set(concoursList.map(c=>c.disc).filter(Boolean));
  const discs = ["Toutes", ...Array.from(discSet).sort((a,b)=>a.localeCompare(b,"fr"))];
  sel.innerHTML = discs.map(d=>`<option value="${safeText(d)}">${safeText(d)}</option>`).join("");
  sel.value = "Toutes";

  // Département
  const deptSet = new Set(concoursList.map(c=>c.dept).filter(Boolean));
  const depts = ["Tous", ...Array.from(deptSet).sort()];
  selDept.innerHTML = depts.map(d=>`<option value="${safeText(d)}">${safeText(d)}</option>`).join("");
  selDept.value = "Tous";

  q.addEventListener("input", (e)=>{ queryText = e.target.value.trim().toLowerCase(); applyFilters(); });
  sel.addEventListener("change", (e)=>{ currentDiscipline = e.target.value; applyFilters(); });
  selDept.addEventListener("change", (e)=>{ currentDept = e.target.value; applyFilters(); });

  const btnToday = document.getElementById("btn-today");
  if(btnToday){
    btnToday.addEventListener("click", ()=>{
      if(cal) cal.today();
    });
  }
  const btnReset = document.getElementById("btn-reset");
  if(btnReset){
    btnReset.addEventListener("click", ()=>{
      queryText = "";
      currentDiscipline = "Toutes";
      currentDept = "Tous";
      q.value = "";
      sel.value = "Toutes";
      selDept.value = "Tous";
      applyFilters();
    });
  }
}

function applyFilters(){
  allowedUids = new Set();

  const discOk = (c)=> currentDiscipline==="Toutes" ? true : (String(c.disc||"") === currentDiscipline);
  const deptOk = (c)=> currentDept==="Tous" ? true : (String(c.dept||"") === currentDept);

  const qOk = (c)=>{
    if(!queryText) return true;
    const hay = [
      c.title, c.disc, c.city, c.cp, c.lieu, c.dept, c.code_structure
    ].join(" ").toLowerCase();
    return hay.includes(queryText);
  };

  for(const c of concoursList){
    if(discOk(c) && deptOk(c) && qOk(c)) allowedUids.add(c.uid);
  }

  // calendrier
  if(cal){
    cal.getEvents().forEach(e=>{
      const ok = allowedUids.has(e.id);
      e.setProp("display", ok ? "auto" : "none");
    });
  }

  renderUpcoming();
  renderMarquee();
  updateNearby(); // carte + liste autour de moi
}

// === Calendrier ===
function initCalendar(){
  const el = document.getElementById("calendar");
  if(!el || !window.FullCalendar) return;

  cal = new FullCalendar.Calendar(el, {
    locale: "fr",
    buttonText: { dayGridMonth: "Mois", listMonth: "Liste", today: "Aujourd\'hui" },
    firstDay: 1,
    height: "auto",
    initialView: "dayGridMonth",
    headerToolbar: { left:"prev,next", center:"title", right:"dayGridMonth,listMonth" },
    events: concoursEvents,
    eventClick: (info)=>{
      info.jsEvent.preventDefault();
      openEventModal(info.event);
    }
  });
  cal.render();
}

// === Modal détails + actions ===
function initModal(){
  const modal = document.getElementById("event-modal");
  if(!modal) return;

  modal.addEventListener("click",(e)=>{
    const t = e.target;
    if(t && t.getAttribute && t.getAttribute("data-close")==="1") closeEventModal();
  });
  document.addEventListener("keydown",(e)=>{
    if(e.key==="Escape" && modal.getAttribute("aria-hidden")==="false") closeEventModal();
  });
}
function closeEventModal(){
  const modal = document.getElementById("event-modal");
  if(!modal) return;
  modal.setAttribute("aria-hidden","true");
  document.body.style.overflow="";
}

function openEventModal(ev){
  const modal = document.getElementById("event-modal");
  if(!modal) return;

  const ep = ev.extendedProps || {};
  const uid = ep.uid || ev.id;

  const titleEl = document.getElementById("modal-title");
  const metaEl = document.getElementById("modal-meta");
  const descEl = document.getElementById("modal-desc");
  const badgesEl = document.getElementById("modal-badges");
  const actionsEl = document.getElementById("modal-actions");

  const title = ev.title || "";
  const disc = ep.discipline || "";
  const lieu = ep.lieu || "";
  const dept = ep.dept || "";
  const mandat = (ep.mandat||"").trim();

  const start = ev.start ? fmtDateFR(ev.start) : "";
  const end = ev.end ? fmtDateFR(addDays(ev.end, -1)) : "";
  const dates = start ? (end && end!==start ? `${start} → ${end}` : start) : "";

  titleEl.textContent = title;
  metaEl.innerHTML = `${safeText(disc)}${(disc&&lieu)?' • ':''}${safeText(lieu)}${dates?(' • '+safeText(dates)):""}`;
  // détails
  const club = ep.club || "";
  const site = ep.site || "";
  const mail = ep.mail || "";
  const mail2 = ep.mail2 || "";

  const lines = [];
  if(club) lines.push(`<div><strong>Club :</strong> ${safeText(club)}</div>`);
  if(site) lines.push(`<div><strong>Site :</strong> <a href="${safeText(site)}" target="_blank" rel="noopener">${safeText(site)}</a></div>`);
  if(mail) lines.push(`<div><strong>Mail :</strong> <a href="mailto:${safeText(mail)}">${safeText(mail)}</a></div>`);
  if(mail2 && mail2 !== mail) lines.push(`<div><strong>Mail (2) :</strong> <a href="mailto:${safeText(mail2)}">${safeText(mail2)}</a></div>`);

  descEl.innerHTML = lines.join("") || "";

  // badges
  const k = discKeyFromLabel(disc);
  const badges = [];
  if(k) badges.push(`<span class="b">${safeText(k.toUpperCase())}</span>`);
  if(dept) badges.push(`<span class="b">Dpt ${safeText(dept)}</span>`);
  badgesEl.innerHTML = badges.join("");

  // actions
  const acts = [];
  acts.push(`<button type="button" class="btn" data-ics-uid="${safeText(uid)}">📅 Ajouter au calendrier</button>`);
  if(mandat) acts.push(`<a class="btn btn-ghost" href="${safeText(mandat)}" target="_blank" rel="noopener">📄 Mandat</a>`);
    // itinéraire (Google Maps)
  const lat = ep.lat;
  const lon = ep.lon;
  const destText = [ep.lieu, ep.cp, ep.city].filter(v=>String(v||"").trim().length).join(" ").trim();
  let mapsUrl = "";
  if(typeof lat === "number" && typeof lon === "number" && !isNaN(lat) && !isNaN(lon)){
    mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lat + "," + lon)}`;
  }else if(destText){
    mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destText)}`;
  }
  if(mapsUrl) acts.push(`<a class="btn btn-ghost" href="${safeText(mapsUrl)}" target="_blank" rel="noopener">🧭 Itinéraire</a>`);
actionsEl.innerHTML = acts.join("");

  modal.setAttribute("aria-hidden","false");
  document.body.style.overflow="hidden";
}

// === Export ICS (Ajouter au calendrier) ===
function buildICS(concours){
  const uid = concours.uid || ("concours-"+Date.now());
  const title = concours.title || "Concours";
  const loc = [concours.lieu, concours.city, concours.cp].filter(Boolean).join(" ").trim();
  const url = concours.mandat || "";

  const dtStart = concours.start ? ymdCompact(concours.start) : null;
  // all-day end is exclusive => +1 jour si multi-jours, sinon +1 jour aussi (standard all-day)
  const endBase = concours.end || concours.start;
  const dtEnd = endBase ? ymdCompact(addDays(endBase, 1)) : null;

  const nowUtc = new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");

  // IMPORTANT: pour compat large, on reste en all-day (VALUE=DATE)
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Comité Régional Tir à l'Arc//Concours//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeICS(uid)}@concours`,
    `DTSTAMP:${nowUtc}`,
    `SUMMARY:${escapeICS(title)}`
  ];
  if(dtStart) lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
  if(dtEnd) lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
  if(loc) lines.push(`LOCATION:${escapeICS(loc)}`);
  if(url) lines.push(`URL:${escapeICS(url)}`);
  lines.push("END:VEVENT","END:VCALENDAR");
  return lines.join("\r\n");
}
function escapeICS(s){
  return String(s||"")
    .replace(/\\/g,"\\\\")
    .replace(/\n/g,"\\n")
    .replace(/,/g,"\\,")
    .replace(/;/g,"\\;");
}
function downloadICSForConcours(concours){
  const ics = buildICS(concours);
  const blob = new Blob([ics], {type:"text/calendar;charset=utf-8"});
  const a = document.createElement("a");
  const filenameSafe = (concours.title||"concours").replace(/[^\w\-]+/g,"_").slice(0,60);
  a.href = URL.createObjectURL(blob);
  a.download = `${filenameSafe}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

// === Prochains concours / Marquee ===
function getFilteredConcours(){
  if(!allowedUids) return concoursList.slice();
  return concoursList.filter(c=>allowedUids.has(c.uid));
}
function renderUpcoming(){
  const wrap = document.getElementById("upcoming");
  if(!wrap) return;

  const list = getFilteredConcours().slice()
    .sort((a,b)=>{
      const as = a.start ? a.start.getTime() : 0;
      const bs = b.start ? b.start.getTime() : 0;
      return as-bs;
    })
    .slice(0, 15);

  if(!list.length){
    wrap.textContent = "Aucun concours à venir avec ces filtres.";
    return;
  }

  wrap.innerHTML = "";
  list.forEach(c=>{
    const k = discKeyFromLabel(c.disc);
    const style = DISC_STYLE[k] || null;

    const card = document.createElement("div");
    card.className = "up-item";
    card.innerHTML = `
      <div class="up-title">${safeText(c.title)}</div>
      <div class="up-meta">
        ${safeText(c.disc)}${c.city?(" • "+safeText(c.city)):""}${c.start?(" • "+safeText(fmtDateFR(c.start))):""}${(c.end && isoDate(c.end)!==isoDate(c.start))?(" → "+safeText(fmtDateFR(c.end))):""}
      </div>
      <div class="up-actions">
        <button class="btn btn-ghost" type="button" data-ics-uid="${safeText(c.uid)}">📅 Ajouter</button>
        ${c.mandat?`<a class="btn btn-ghost" href="${safeText(c.mandat)}" target="_blank" rel="noopener">📄 Mandat</a>`:""}
      </div>
    `;
    // badge couleur en bord gauche (si tu veux)
    if(style){
      card.style.borderLeft = `6px solid ${style.fill}`;
    }
    card.addEventListener("click", (e)=>{
      // éviter double clic quand on clique sur un bouton
      if(e.target && (e.target.closest(".up-actions"))) return;
      // Ouvrir la modale via l'event FC correspondant si possible
      if(cal){
        const ev = cal.getEventById(c.uid);
        if(ev) openEventModal(ev);
      }
    });
    wrap.appendChild(card);
  });
}

function renderMarquee(){
  // Supporte id correct OU fallback sur la classe si le HTML est mal formé
  const wrap = document.getElementById("marquee-wrap") || document.querySelector(".marquee-wrap");
  const track = document.getElementById("marquee-track");
  if(!wrap || !track) return;

  const now = today00();

  // On affiche les DATES CLÉS à J-30 (objectif du bandeau)
  const list = (datesCles||[]).filter(d=>{
    if(!d.start) return false;
    const dd = new Date(d.start.getFullYear(), d.start.getMonth(), d.start.getDate());
    const diff = Math.round((dd-now)/(1000*60*60*24));
    return diff>=0 && diff<=30;
  }).sort((a,b)=>a.start-b.start);

  if(!list.length){
    wrap.hidden = true;
    track.innerHTML = "";
    return;
  }

  wrap.hidden = false;

  const itemsHTML = list.map(d=>{
    const when = fmtDateFR(d.start);
    const title = d.title || d.name || d.label || "";
    return `<span class="marquee-item">${safeText(when)} • ${safeText(title)}</span>`;
  }).join("");

  // Duplique pour un défilement continu (la CSS translateX(-50%) l'attend)
  track.innerHTML = itemsHTML + itemsHTML;

  // Ajuste la durée selon le nombre d'items (un peu plus lent si peu d'items)
  const n = Math.max(1, list.length);
  const seconds = Math.min(40, Math.max(18, 10 + n*3));
  track.style.animationDuration = seconds + "s";
}

// === Timeline dates clés ===
function renderTimeline(){
  const tl = document.getElementById("timeline");
  const pill = document.getElementById("today-pill");
  if(pill) pill.textContent = "Aujourd’hui : " + fmtDateFR(new Date());
  if(!tl) return;

  if(!datesCles.length){
    tl.textContent = "Aucune date clé à venir.";
    return;
  }

  const items = datesCles.slice().sort((a,b)=>a.start-b.start);
  const monthFmt = new Intl.DateTimeFormat("fr-FR", { month:"long", year:"numeric" });

  // group by month
  const groups = new Map();
  for(const d of items){
    const key = `${d.start.getFullYear()}-${String(d.start.getMonth()+1).padStart(2,"0")}`;
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }

  tl.innerHTML = "";

  for(const [, list] of groups){
    const monthTitle = document.createElement("div");
    monthTitle.className = "month-title";
    monthTitle.textContent = monthFmt.format(list[0].start);
    tl.appendChild(monthTitle);

    const vt = document.createElement("div");
    vt.className = "vt";

    list.forEach(d=>{
      const wrap = document.createElement("div");
      wrap.className = "vt-item";

      const dot = document.createElement("div");
      dot.className = "vt-dot";

      const t = (d.type || "").toLowerCase();
      const imp = (d.importance || "").toLowerCase();
      const title = (d.title || "").toLowerCase();

      let cardClass = "vt-card";

      // CODIR / Comité directeur (prioritaire)
      const isCodir = t.includes("codir") || title.includes("comité directeur") || title.includes("comite directeur") || t.includes("comité directeur") || t.includes("comite directeur");
      if(isCodir){
        cardClass += " codir";
      } else if(imp === "haute"){
        cardClass += " deadline";
      } else if(t.includes("institution") || t.includes("inst")){
        cardClass += " inst";
      }

      // France
      if(title.includes("championnat de france") || title.includes("france")){
        cardClass += " france";
      }

      // Sirènes
      if(title.includes("sirene") || title.includes("sirènes")){
        cardClass += " sirenes";
      }

      const card = document.createElement("div");
      card.className = cardClass;

      const multi = d.end && isoDate(d.end) !== isoDate(d.start);
      const dates = `${fmtDateFR(d.start)}${multi ? (" → " + fmtDateFR(d.end)) : ""}`;
      const metaParts = [dates, d.lieu || "", d.precision || ""].filter(Boolean);

      // badges (sans importance)
      const badges = [];
      if(d.type) badges.push(`<span class="badge">${safeText(d.type)}</span>`);
      if(multi) badges.push(`<span class="badge">📅 multi-jours</span>`);

      // icônes / actions
      let actionHtml = "";
      if(isCodir){
        actionHtml = `<a class="cd-mail" href="mailto:s-general@arc-paysdelaloire.fr" title="Une question, un message, n’hésitez pas 😃" aria-label="Contacter le secrétariat" rel="noopener"></a>`;
      } else if(d.mandat){
        if(cardClass.includes("france")){
          actionHtml = `<a class="fr-mandat" href="${safeText(d.mandat)}" target="_blank" rel="noopener" aria-label="Document championnat de France">📄</a>`;
        } else {
          actionHtml = `<a class="mandat-ico" href="${safeText(d.mandat)}" target="_blank" rel="noopener" aria-label="Document">📄</a>`;
        }
      }

      card.innerHTML = `
        ${actionHtml}
        <div class="vt-title">${safeText(d.title)}</div>
        <div class="vt-meta">${safeText(metaParts.join(" • "))}</div>
        ${badges.length ? `<div class="vt-badges">${badges.join("")}</div>` : ""}
      `;

      wrap.appendChild(dot);
      wrap.appendChild(card);
      vt.appendChild(wrap);
    });

    tl.appendChild(vt);
  }
}

// === Carte / Autour de moi ===
function initNearby(){
  const mapEl = document.getElementById("nearby-map");
  const btn = document.getElementById("btn-locate");
  const slider = document.getElementById("radius");
  const val = document.getElementById("radius-val");
  const status = document.getElementById("nearby-status");
  if(!mapEl || !btn || !slider || !status) return;

  if(!window.L || !L.map){
    status.textContent = "Carte indisponible (Leaflet non chargé).";
    return;
  }

  nearby.radius = parseInt(slider.value,10) || 50;
  val.textContent = nearby.radius + " km";

  nearby.map = L.map(mapEl, { zoomControl:true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap"
  }).addTo(nearby.map);
  nearby.layer = L.layerGroup().addTo(nearby.map);

  // centre par défaut : moyenne (sur concours filtrés si possible)
  const base = getFilteredConcours().filter(c=>Number.isFinite(c.lat) && Number.isFinite(c.lon));
  const arr = base.length ? base : concoursList.filter(c=>Number.isFinite(c.lat) && Number.isFinite(c.lon));
  if(arr.length){
    const avg = arr.reduce((a,c)=>({lat:a.lat+c.lat, lon:a.lon+c.lon}), {lat:0,lon:0});
    nearby.map.setView([avg.lat/arr.length, avg.lon/arr.length], 7);
  }else{
    status.textContent = "Carte indisponible : pas de concours avec coordonnées GPS.";
    mapEl.style.display = "none";
    return;
  }

  btn.addEventListener("click", ()=>{
    if(!navigator.geolocation){
      status.textContent = "Géolocalisation non supportée.";
      return;
    }
    status.textContent = "Localisation en cours…";
    navigator.geolocation.getCurrentPosition((pos)=>{
      nearby.user = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      status.textContent = "Localisé. Ajuste le rayon pour filtrer.";
      updateNearby();
    }, ()=>{
      status.textContent = "Impossible d'obtenir la localisation.";
    }, { enableHighAccuracy:true, timeout:10000, maximumAge:60000 });
  });

  slider.addEventListener("input", ()=>{
    nearby.radius = parseInt(slider.value,10) || 50;
    val.textContent = nearby.radius + " km";
    updateNearby();
  });

  updateNearby();
}

function markerStyleForDisc(label){
  const k = discKeyFromLabel(label);
  const st = DISC_STYLE[k] || {fill:"#64748b", stroke:"#0f172a", text:"#fff"};
  return {k, st};
}

function updateNearby(){
  const status = document.getElementById("nearby-status");
  const itemsEl = document.getElementById("nearby-items");
  if(!status || !itemsEl) return;
  if(!nearby.map || !nearby.layer) return;

  nearby.layer.clearLayers();
  itemsEl.innerHTML = "";

  const filtered = getFilteredConcours().filter(c=>Number.isFinite(c.lat) && Number.isFinite(c.lon));

  if(!nearby.user){
    // mode "aperçu" : afficher les concours filtrés (à venir) sur la carte
    status.textContent = "Clique sur “Me localiser” pour voir les concours dans ton rayon.";
    if(!filtered.length){
      status.textContent = "Aucun concours (avec GPS) pour ces filtres.";
      return;
    }

    const bounds = L.latLngBounds([]);
    filtered.forEach(c=>{
      const {st} = markerStyleForDisc(c.disc);
      const opt = {
        radius: 7,
        weight: 2,
        fillOpacity: 0.85,
        color: st.stroke,
        fillColor: st.fill
      };
      const m = L.circleMarker([c.lat, c.lon], opt).addTo(nearby.layer);

      const dates = (c.start?fmtDateFR(c.start):"") + (c.end && isoDate(c.end)!==isoDate(c.start)?(" → "+fmtDateFR(c.end)):"");
      const pop = `
        <b>${safeText(c.title)}</b><br/>
        ${safeText(c.disc)}${c.city?(" • "+safeText(c.city)):""}${dates?("<br/>"+safeText(dates)):""}
        <div class="popup-actions">
          <a href="#" data-ics-uid="${safeText(c.uid)}">📅 Ajouter</a>
          ${c.mandat?`<a href="${safeText(c.mandat)}" target="_blank" rel="noopener">📄 Mandat</a>`:""}
          <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.lat+","+c.lon)}" target="_blank" rel="noopener">🧭 Itinéraire</a>
        </div>
      `;
      m.bindPopup(pop);
      bounds.extend([c.lat, c.lon]);
    });
    try{ nearby.map.fitBounds(bounds.pad(0.2)); }catch(e){}
    return;
  }

  // mode localisé : rayon + filtres
  const {lat, lon} = nearby.user;
  const within = filtered.map(c=>({ ...c, km: haversineKm(lat, lon, c.lat, c.lon) }))
    .filter(c=>c.km <= nearby.radius)
    .sort((a,b)=>a.km-b.km);

  // marker utilisateur
  const me = L.circleMarker([lat, lon], { radius: 8, weight:2, fillOpacity:0.9 }).addTo(nearby.layer);
  me.bindPopup("Vous êtes ici");
  me.openPopup();

  if(!within.length){
    status.textContent = "Aucun concours dans un rayon de " + nearby.radius + " km (avec ces filtres).";
    nearby.map.setView([lat, lon], 9);
    return;
  }

  status.textContent = within.length + " concours dans " + nearby.radius + " km.";
  const bounds = L.latLngBounds([[lat, lon]]);
  within.forEach(c=>{
    const {st} = markerStyleForDisc(c.disc);
    const m = L.circleMarker([c.lat, c.lon], { radius: 7, weight:2, fillOpacity:0.85, color: st.stroke, fillColor: st.fill }).addTo(nearby.layer);
    const dates = (c.start?fmtDateFR(c.start):"") + (c.end && isoDate(c.end)!==isoDate(c.start)?(" → "+fmtDateFR(c.end)):"");
    const pop = `
      <b>${safeText(c.title)}</b><br/>
      ${safeText(c.disc)}${c.city?(" • "+safeText(c.city)):""}${dates?("<br/>"+safeText(dates)):""}
      <div class="popup-actions">
        <a href="#" data-ics-uid="${safeText(c.uid)}">📅 Ajouter</a>
        ${c.mandat?`<a href="${safeText(c.mandat)}" target="_blank" rel="noopener">📄 Mandat</a>`:""}
        <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.lat+","+c.lon)}" target="_blank" rel="noopener">🧭 Itinéraire</a>
      </div>
    `;
    m.bindPopup(pop);
    bounds.extend([c.lat, c.lon]);

    // carte liste
    const card = document.createElement("div");
    card.className = "nearby-card";
    const meta = `${safeText(c.disc)}${(c.city)?' • '+safeText(c.city):''}${dates?(' • '+safeText(dates)):""}`;
    card.innerHTML = `
      <div>
        <div class="nearby-title">${safeText(c.title)}</div>
        <div class="nearby-meta">${meta}</div>
      </div>
      <div class="nearby-actions">
        <div class="nearby-km">${Math.round(c.km)} km</div>
        <button class="nearby-mandat" type="button" title="Ajouter au calendrier" data-ics-uid="${safeText(c.uid)}">📅</button>
        ${c.mandat?`<a class="nearby-mandat" href="${safeText(c.mandat)}" target="_blank" rel="noopener" title="Ouvrir le mandat">📄</a>`:""}
        <a class="nearby-route" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.lat+","+c.lon)}" target="_blank" rel="noopener" title="Itinéraire">🧭</a>
      </div>
    `;
    card.addEventListener("click",(e)=>{
      if(e.target && (e.target.closest(".nearby-actions"))) return;
      nearby.map.setView([c.lat, c.lon], Math.max(nearby.map.getZoom(), 11));
      m.openPopup();
    });
    itemsEl.appendChild(card);
  });

  try{ nearby.map.fitBounds(bounds.pad(0.25)); }catch(e){}
}
