// ── Utilitaires ────────────────────────────────────────────────────────────
function safeText(s) {
  return String(s ?? "").replace(/[&<>"']/g, m =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));
}
function parseFRDate(d) {
  const s = String(d || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y,m,dd] = s.split("-").map(Number);
    return new Date(y, m-1, dd);
  }
  const mt = s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (mt) {
    let y = Number(mt[3]); if (y < 100) y += 2000;
    return new Date(y, Number(mt[2])-1, Number(mt[1]));
  }
  const dt = new Date(s); return isNaN(dt) ? null : dt;
}
function fmtDateFR(d) {
  const dt = (d instanceof Date) ? d : parseFRDate(d);
  if (!dt) return "";
  return dt.toLocaleDateString("fr-FR", { weekday:"short", day:"2-digit", month:"short", year:"numeric" });
}
function isoDate(d) {
  const dt = (d instanceof Date) ? d : parseFRDate(d);
  if (!dt) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function today00() { const t = new Date(); t.setHours(0,0,0,0); return t; }
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, r = x => x * Math.PI / 180;
  const a = Math.sin(r(lat2-lat1)/2)**2 + Math.cos(r(lat1))*Math.cos(r(lat2))*Math.sin(r(lon2-lon1)/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Discipline → couleur ───────────────────────────────────────────────────
function discKey(label) {
  const s = String(label || "").toLowerCase();
  if (s.includes("para") && (s.includes("18") || s.includes("salle"))) return "para18m";
  if (s.includes("para")) return "paraext";
  if (s.includes("campagne")) return "campagne";
  if (s.includes("beursault")) return "beursault";
  if (s.includes("3d") || s.includes("trois")) return "3d";
  if (s.includes("nature")) return "nature";
  if (s.includes("run") || s.includes("course") || s.includes("vélo") || s.includes("velo")) return "run";
  if (s.includes("18") || s.includes("salle") || s.includes("indoor")) return "18m";
  if (s.includes("extérieur") || s.includes("exterieur") || s.includes("tae") || s.includes("outdoor")) return "tae";
  if (s.includes("loisir")) return "loisir";
  if (s.includes("jeune") || s.includes("poussin") || s.includes("benjamin") || s.includes("cadet")) return "jeune";
  return "autre";
}
const DISC_COLOR = {
  tae:      "#ffe600", "18m":    "#1a56db", nature:   "#6b7c3a",
  "3d":     "#7c4a2a", campagne: "#111111", beursault:"#ffffff",
  loisir:   "#e91e8c", jeune:    "#7c3aed", run:      "#e53935",
  para18m:  "#4fc3f7", paraext:  "#ff6d00", autre:    "#94a3b8",
};
// border color: [fill, stroke]
const DISC_BORDER = {
  tae:      "rgba(0,0,0,.5)",   "18m":    "rgba(255,255,255,.5)",
  nature:   "rgba(0,0,0,.35)",  "3d":     "rgba(0,0,0,.35)",
  campagne: "#ffe600",           beursault:"rgba(0,0,0,.8)",
  loisir:   "rgba(0,0,0,.3)",   jeune:    "rgba(255,255,255,.5)",
  run:      "rgba(255,255,255,.5)", para18m:"rgba(0,0,0,.3)",
  paraext:  "rgba(255,255,255,.4)", autre:  "rgba(0,0,0,.3)",
};
const DISC_LABELS = {
  tae:      "TAE – Tir Extérieur",
  "18m":    "Tir en Salle 18m",
  "3d":     "Tir 3D",
  campagne: "Tir en Campagne",
  nature:   "Tir Nature",
  beursault:"Tir Beursault",
  run:      "Run Archerie",
  loisir:   "Loisirs",
  jeune:    "Jeunes / Poussins",
  para18m:  "Para-tir salle",
  paraext:  "Para-tir extérieur",
  autre:    "Autre",
};

// ── Chargement CSV ─────────────────────────────────────────────────────────
async function loadCSV(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const txt = await res.text();
  const lines = txt.replace(/\r/g, "").split("\n").filter(l => l.trim());
  const headers = lines[0].split(";").map((h, i) => h.trim() || `__col${i}`);
  return lines.slice(1).map(line => {
    const parts = line.split(";");
    const row = {};
    headers.forEach((h, j) => row[h] = (parts[j] ?? "").trim());
    return row;
  });
}

// ── État global ────────────────────────────────────────────────────────────
let allConcours = [];   // tous les concours chargés
let filtered    = null; // null = pas de filtre, sinon Set<uid>
let map         = null;
let markerLayer = null;
let userMarker  = null;
let userLatLon  = null;

// ── Init ───────────────────────────────────────────────────────────────────
init();

async function init() {
  initMap();
  try {
    const rows = await loadCSV("concours26.csv");
    buildConcours(rows);
    initFilters();
    renderMarkers(allConcours);
    fitMapToConcours(allConcours);
  } catch (err) {
    console.error("Chargement CSV :", err);
  }
  initModal();
}

// ── Construction objets concours ───────────────────────────────────────────
function buildConcours(rows) {
  const t0 = today00();
  allConcours = rows.map((r, idx) => {
    const title  = (r["Titre compétition"] || r["Titre competition"] || r["Titre"] || "Concours").trim();
    const startD = parseFRDate(r["Date debut"] || r["Date début"]);
    const endD   = parseFRDate(r["Date fin"]   || r["Date Fin"]);
    const start  = startD || endD || null;
    const end    = endD   || startD || null;

    const disc   = (r["Discipline"] || "").trim();
    const dept   = (r["Departement"] || r["Département"] || "").trim();
    const region = (r["Code region"] || r["Code région"] || "").trim();
    const city   = (r["Ville"] || r["Commune"] || "").trim();
    const cp     = (r["CP"] || r["Code postal"] || "").trim();
    const lieu   = (r["Lieu"] || r["Lieu tir"] || "").trim();
    const club   = (r["Club organisateur"] || r["Club"] || "").trim();
    const mail   = (r["Mail"] || "").trim();
    const site   = (r["Site web"] || "").trim();
    const mandat = (r["Mandat"] || "").trim();
    const etat   = (r["Etat"] || "").trim();

    const latRaw = String(r["Lat"] ?? "").replace(",", ".").trim();
    const lonRaw = String(r["Long"] ?? "").replace(",", ".").trim();
    const lat = parseFloat(latRaw) || null;
    const lon = parseFloat(lonRaw) || null;
    const hasGPS = lat && lon && Math.abs(lat) > 1 && Math.abs(lon) > 0.01;

    const uid = `${title}__${isoDate(start)||"na"}__${dept}__${idx}`.replace(/\s+/g, "_");
    return { uid, title, disc, discCat: discKey(disc), dept, region, city, cp, lieu, club, mail, site, mandat, etat,
             start, end, lat: hasGPS ? lat : null, lon: hasGPS ? lon : null };
  }).filter(c => {
    if (!c.start) return false;
    const endDt = new Date((c.end || c.start).getFullYear(), (c.end || c.start).getMonth(), (c.end || c.start).getDate());
    return endDt >= t0;
  });
}

// ── Carte ──────────────────────────────────────────────────────────────────
function initMap() {
  map = L.map("map", { zoomControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, attribution: "© OpenStreetMap"
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.setView([46.8, 2.3], 6);
  addLegend();
}

function addLegend() {
  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = function() {
    const div = L.DomUtil.create("div", "map-legend");
    div.innerHTML = Object.entries(DISC_LABELS)
      .filter(([k]) => k !== "autre")
      .map(([k, label]) => {
        const bg  = DISC_COLOR[k]  || "#94a3b8";
        const brd = DISC_BORDER[k] || "rgba(0,0,0,.3)";
        const bw  = k === "campagne" ? "3px" : "2px";
        return `<div class="leg-row"><span class="leg-dot" style="background:${bg};border-color:${brd};border-width:${bw}"></span>${label}</div>`;
      }).join("");
    return div;
  };
  legend.addTo(map);
}

function makeIcon(disc) {
  const k   = discKey(disc);
  const bg  = DISC_COLOR[k]  || "#94a3b8";
  const brd = DISC_BORDER[k] || "rgba(0,0,0,.35)";
  const bw  = k === "campagne" ? "3px" : "2px";
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:999px;background:${bg};border:${bw} solid ${brd};box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7],
  });
}

function renderMarkers(list) {
  markerLayer.clearLayers();
  list.forEach(c => {
    if (!c.lat || !c.lon) return;
    const mk = L.marker([c.lat, c.lon], { icon: makeIcon(c.disc) });
    mk.bindPopup(buildPopupHTML(c), { maxWidth: 300 });
    mk.on("click", () => openModal(c));
    markerLayer.addLayer(mk);
  });
}

function fitMapToConcours(list) {
  const pts = list.filter(c => c.lat && c.lon).map(c => [c.lat, c.lon]);
  if (!pts.length) return;
  try { map.fitBounds(L.latLngBounds(pts).pad(0.1)); } catch(e) {}
}

function buildPopupHTML(c) {
  const dates = fmtDateFR(c.start) + (c.end && isoDate(c.end) !== isoDate(c.start) ? " → " + fmtDateFR(c.end) : "");
  const links = [];
  if (c.mandat) links.push(`<a href="${safeText(c.mandat)}" target="_blank">📄 Mandat</a>`);
  const dest = c.lat ? `${c.lat},${c.lon}` : [c.lieu, c.cp, c.city].filter(Boolean).join(" ");
  if (dest) links.push(`<a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}" target="_blank">🧭 Itinéraire</a>`);
  return `<b>${safeText(c.title)}</b><br/>${safeText(c.disc)}${c.city ? " · " + safeText(c.city) : ""}<br/><span style="color:#64748b">${safeText(dates)}</span>${links.length ? `<div class="popup-actions">${links.join("")}</div>` : ""}`;
}

// ── Filtres ────────────────────────────────────────────────────────────────
function initFilters() {
  // Remplir selects dynamiquement
  const cats   = [...new Set(allConcours.map(c => c.discCat).filter(Boolean))];
  const catsSorted = Object.keys(DISC_LABELS).filter(k => cats.includes(k));
  const depts  = [...new Set(allConcours.map(c => c.dept).filter(Boolean))].sort();
  const selDisc = document.getElementById("f-disc");
  const selDept = document.getElementById("f-dept");
  catsSorted.forEach(k => { const o = document.createElement("option"); o.value = k; o.textContent = DISC_LABELS[k] || k; selDisc.appendChild(o); });
  depts.forEach(d => { const o = document.createElement("option"); o.value = d; o.textContent = `Dpt ${d}`; selDept.appendChild(o); });

  const inputs = ["f-region","f-dept","f-disc","f-q"].map(id => document.getElementById(id));
  inputs.forEach(el => el.addEventListener(el.tagName==="INPUT" ? "input" : "change", applyFilters));

  document.getElementById("btn-reset").addEventListener("click", () => {
    inputs.forEach(el => { el.tagName==="INPUT" ? el.value="" : el.selectedIndex=0; });
    if (userMarker) { markerLayer.removeLayer(userMarker); userMarker = null; }
    userLatLon = null;
    applyFilters();
  });

  document.getElementById("btn-locate").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      userLatLon = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (userMarker) markerLayer.removeLayer(userMarker);
      userMarker = L.circleMarker([userLatLon.lat, userLatLon.lon],
        { radius:10, color:"#0b3b63", fillColor:"#3b82f6", fillOpacity:.9, weight:3 })
        .bindPopup("Vous êtes ici").addTo(markerLayer);
      map.setView([userLatLon.lat, userLatLon.lon], 9);
      applyFilters();
    });
  });
}

function getFilterValues() {
  return {
    region: document.getElementById("f-region").value,
    dept:   document.getElementById("f-dept").value,
    disc:   document.getElementById("f-disc").value,
    q:      document.getElementById("f-q").value.trim().toLowerCase(),
  };
}

function hasFilter(fv) {
  return fv.region || fv.dept || fv.disc || fv.q || userLatLon;
}

function applyFilters() {
  const fv = getFilterValues();
  let list = allConcours;

  if (fv.region) list = list.filter(c => c.region  === fv.region);
  if (fv.dept)   list = list.filter(c => c.dept    === fv.dept);
  if (fv.disc)   list = list.filter(c => c.discCat === fv.disc);
  if (fv.q)      list = list.filter(c => [c.title, c.disc, c.city, c.cp, c.club, c.dept].join(" ").toLowerCase().includes(fv.q));

  if (userLatLon) {
    list = list
      .map(c => ({ ...c, km: c.lat ? haversineKm(userLatLon.lat, userLatLon.lon, c.lat, c.lon) : Infinity }))
      .filter(c => c.km <= 100)
      .sort((a,b) => a.km - b.km);
  } else {
    list = list.sort((a,b) => (a.start?.getTime()||0) - (b.start?.getTime()||0));
  }

  renderMarkers(list);
  if (list.length) fitMapToConcours(list);
  window.updateFilterBadge?.();

  if (hasFilter(fv)) {
    renderPanel(list);
    document.body.classList.add("panel-open");
  } else {
    document.body.classList.remove("panel-open");
    renderMarkers(allConcours);
    fitMapToConcours(allConcours);
  }

  setTimeout(() => { map.invalidateSize(); }, 320);
}

// ── Panneau droit ──────────────────────────────────────────────────────────
function renderPanel(list) {
  const count = document.getElementById("panel-count");
  const items = document.getElementById("panel-items");

  count.textContent = `${list.length} concours`;
  items.innerHTML   = "";

  if (!list.length) {
    items.innerHTML = `<div style="padding:16px;color:#64748b;font-weight:600">Aucun concours pour ces filtres.</div>`;
    return;
  }

  list.forEach(c => {
    const k     = discKey(c.disc);
    const color = DISC_COLOR[k] || "#cbd5e1";
    const dates = fmtDateFR(c.start) + (c.end && isoDate(c.end) !== isoDate(c.start) ? " → " + fmtDateFR(c.end) : "");

    const card = document.createElement("div");
    card.className = "ev-card";
    card.style.borderLeftColor = color;

    const actions = [];
    if (c.mandat) actions.push(`<a href="${safeText(c.mandat)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📄 Mandat</a>`);
    const dest = c.lat ? `${c.lat},${c.lon}` : [c.lieu, c.cp, c.city].filter(Boolean).join(" ");
    if (dest) actions.push(`<a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🧭 Itinéraire</a>`);

    const kmTxt = c.km && c.km < Infinity ? `<span style="font-weight:800;color:#0b3b63">${Math.round(c.km)} km · </span>` : "";

    card.innerHTML = `
      <div class="ev-card-top">
        <div class="ev-card-title">${safeText(c.title)}</div>
        <div class="ev-disc-dot" style="background:${safeText(color)}"></div>
      </div>
      <div class="ev-card-meta">${kmTxt}${safeText(c.disc)}${c.city ? " · " + safeText(c.city) : ""}${c.dept ? " ("+safeText(c.dept)+")" : ""}</div>
      <div class="ev-card-meta">${safeText(dates)}</div>
      ${actions.length ? `<div class="ev-card-actions">${actions.join("")}</div>` : ""}
    `;
    card.addEventListener("click", () => {
      openModal(c);
      if (c.lat && c.lon) map.setView([c.lat, c.lon], 13);
    });
    items.appendChild(card);
  });
}

document.getElementById("panel-close").addEventListener("click", () => {
  document.body.classList.remove("panel-open");
  setTimeout(() => map.invalidateSize(), 360);
});

// ── Mobile : filtre bottom sheet ───────────────────────────────────────────
(function() {
  const toggleBtn  = document.getElementById("btn-filter-toggle");
  const backdrop   = document.getElementById("filter-backdrop");
  const filtersBar = document.getElementById("filters-bar");
  const badge      = document.getElementById("filter-badge");

  function openFilters()  { document.body.classList.add("filters-open"); }
  function closeFilters() { document.body.classList.remove("filters-open"); }

  toggleBtn?.addEventListener("click", () => {
    document.body.classList.toggle("filters-open");
  });
  backdrop?.addEventListener("click", closeFilters);

  // Fermer le sheet quand on change un filtre (mobile UX)
  ["f-region","f-dept","f-disc"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => {
      if (window.innerWidth <= 820) setTimeout(closeFilters, 300);
    });
  });

  // Mettre à jour le badge
  window.updateFilterBadge = function() {
    const fv = getFilterValues();
    const count = [fv.region, fv.dept, fv.disc, fv.q, userLatLon].filter(Boolean).length;
    if (!badge) return;
    if (count > 0) { badge.textContent = count; badge.hidden = false; }
    else           { badge.hidden = true; }
  };

  // Boutons dupliqués topbar mobile (locate + reset)
  document.getElementById("btn-locate-top")?.addEventListener("click", () => {
    document.getElementById("btn-locate")?.click();
    closeFilters();
  });
  document.getElementById("btn-reset-top")?.addEventListener("click", () => {
    document.getElementById("btn-reset")?.click();
    closeFilters();
  });
})();

// ── Modal ──────────────────────────────────────────────────────────────────
function initModal() {
  const modal = document.getElementById("modal");
  modal.addEventListener("click", e => {
    if (e.target.dataset.close) closeModal();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && modal.getAttribute("aria-hidden") === "false") closeModal();
  });
}
function closeModal() {
  document.getElementById("modal").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}
function openModal(c) {
  const dates = fmtDateFR(c.start) + (c.end && isoDate(c.end) !== isoDate(c.start) ? " → " + fmtDateFR(c.end) : "");
  const k = discKey(c.disc);

  document.getElementById("modal-title").textContent = c.title;
  document.getElementById("modal-meta").textContent  = [c.disc, c.city, dates].filter(Boolean).join(" · ");

  const desc = [];
  if (c.club)  desc.push(`<div><strong>Club :</strong> ${safeText(c.club)}</div>`);
  if (c.lieu)  desc.push(`<div><strong>Lieu :</strong> ${safeText(c.lieu)}</div>`);
  if (c.cp || c.city) desc.push(`<div><strong>Adresse :</strong> ${safeText([c.cp, c.city].filter(Boolean).join(" "))}</div>`);
  if (c.site)  desc.push(`<div><strong>Site :</strong> <a href="${safeText(c.site)}" target="_blank">${safeText(c.site)}</a></div>`);
  if (c.mail)  desc.push(`<div><strong>Mail :</strong> <a href="mailto:${safeText(c.mail)}">${safeText(c.mail)}</a></div>`);
  if (c.etat && c.etat !== "Validée") desc.push(`<div><strong>État :</strong> ${safeText(c.etat)}</div>`);
  document.getElementById("modal-desc").innerHTML = desc.join("") || "";

  const badges = [];
  if (c.disc) badges.push(`<span class="b">${safeText(c.disc)}</span>`);
  if (c.dept) badges.push(`<span class="b">Dpt ${safeText(c.dept)}</span>`);
  if (c.region) badges.push(`<span class="b">${safeText(c.region)}</span>`);
  document.getElementById("modal-badges").innerHTML = badges.join("");

  const acts = [];
  if (c.mandat) acts.push(`<a href="${safeText(c.mandat)}" target="_blank" rel="noopener">📄 Mandat</a>`);
  const dest = c.lat ? `${c.lat},${c.lon}` : [c.lieu, c.cp, c.city].filter(Boolean).join(" ");
  if (dest) acts.push(`<a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}" target="_blank" rel="noopener">🧭 Itinéraire</a>`);
  acts.push(`<button type="button" onclick="downloadICS(window._modalConcours)">📅 Ajouter au calendrier</button>`);
  document.getElementById("modal-actions").innerHTML = acts.join("");

  window._modalConcours = c;
  document.getElementById("modal").setAttribute("aria-hidden", "false");
}

// ── Export ICS ─────────────────────────────────────────────────────────────
function ymdCompact(d) {
  const dt = (d instanceof Date) ? d : parseFRDate(d);
  if (!dt) return null;
  return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,"0")}${String(dt.getDate()).padStart(2,"0")}`;
}
function downloadICS(c) {
  const uid   = (c.uid || Date.now()) + "@ffta-cal";
  const now   = new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
  const loc   = [c.lieu, c.cp, c.city].filter(Boolean).join(" ");
  const dtS   = ymdCompact(c.start);
  const dtE   = c.end ? ymdCompact(addDays(c.end, 1)) : (dtS ? ymdCompact(addDays(c.start, 1)) : null);
  const esc   = s => String(s||"").replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
  const lines = [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//FFTA Calendrier//FR","CALSCALE:GREGORIAN","METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${esc(uid)}`, `DTSTAMP:${now}`, `SUMMARY:${esc(c.title)}`,
    dtS ? `DTSTART;VALUE=DATE:${dtS}` : "",
    dtE ? `DTEND;VALUE=DATE:${dtE}` : "",
    loc ? `LOCATION:${esc(loc)}` : "",
    c.mandat ? `URL:${esc(c.mandat)}` : "",
    "END:VEVENT","END:VCALENDAR"
  ].filter(Boolean);
  const blob = new Blob([lines.join("\r\n")], { type:"text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (c.title||"concours").replace(/[^\w\-]+/g,"_").slice(0,60) + ".ics";
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
