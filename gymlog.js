/* ═══════════════════════════════════════════
   DATA
═══════════════════════════════════════════ */
const STORE = 'gymlog_v4';

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || defDB(); }
  catch { return defDB(); }
}

function defDB() {
  return { profile: { weight: null, height: null, age: null, gender: 'm' }, schedule: {}, prs: {}, dayTags: {}, notif: { enabled: false } };
}

function persist() {
  localStorage.setItem(STORE, JSON.stringify(db));
}

let db = load();

const DAY_KEYS  = ['mon','tue','wed','thu','fri','sat','sun'];
const DAY_LONG  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DAY_SHORT = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

function todayKey() {
  return DAY_KEYS[[6,0,1,2,3,4,5][new Date().getDay()]];
}

function uid() { return Math.random().toString(36).slice(2)+Date.now().toString(36); }

function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.toLocaleString('en',{month:'short'})} ${d.getDate()}, ${d.getFullYear()}`;
}

/* ═══════════════════════════════════════════
   EXERCISES DATABASE
═══════════════════════════════════════════ */
const EX_DB = {
  'Chest':     ['Bench Press','Incline Bench Press','Decline Bench Press','Dumbbell Fly','Cable Fly','Dips','Push-up'],
  'Back':      ['Deadlift','Pull-up','Chin-up','Barbell Row','Lat Pulldown','Seated Row','T-Bar Row','Face Pull'],
  'Legs':      ['Squat','Front Squat','Leg Press','Romanian Deadlift','Leg Extension','Leg Curl','Hip Thrust','Calf Raise','Hack Squat'],
  'Shoulders': ['Overhead Press','Dumbbell Shoulder Press','Lateral Raise','Front Raise','Arnold Press','Shrugs'],
  'Arms':      ['Barbell Curl','Dumbbell Curl','Hammer Curl','Preacher Curl','Tricep Pushdown','Skull Crusher','Overhead Tricep Extension'],
  'Core':      ['Plank','Ab Wheel','Hanging Leg Raise','Crunch','Russian Twist','Cable Crunch'],
};

const COMPOUND_LIFTS = ['Bench Press','Squat','Deadlift','Overhead Press','Barbell Row','Front Squat'];

/* ═══════════════════════════════════════════
   EXERCISE DIFFICULTY COEFFICIENTS
   Source: derived from Symmetric Strength & ExRx.net strength standards.
   Each value = expected lift / LBM^0.667 for a trained recreational lifter.
   Bench Press = 1.0 baseline. Higher = more weight expected (harder to rank up),
   lower = less weight expected (easier to rank relative to body composition).
   This makes each exercise rank independently fair.
═══════════════════════════════════════════ */
const EX_COEFF = {
  // Chest
  'Bench Press':               1.00,
  'Incline Bench Press':       0.88,
  'Decline Bench Press':       1.05,
  'Dumbbell Fly':              0.55,
  'Cable Fly':                 0.45,
  'Dips':                      1.50,
  'Push-up':                   1.36,
  // Back
  'Deadlift':                  1.75,
  'Pull-up':                   1.55,
  'Chin-up':                   1.55,
  'Barbell Row':                0.92,
  'Lat Pulldown':              0.82,
  'Seated Row':                0.75,
  'T-Bar Row':                 0.90,
  'Face Pull':                 0.40,
  // Legs
  'Squat':                     1.50,
  'Front Squat':               1.25,
  'Leg Press':                 1.90,
  'Romanian Deadlift':         1.20,
  'Leg Extension':             0.70,
  'Leg Curl':                  0.65,
  'Hip Thrust':                1.55,
  'Calf Raise':                0.80,
  'Hack Squat':                1.40,
  // Shoulders
  'Overhead Press':            0.65,
  'Dumbbell Shoulder Press':   0.58,
  'Lateral Raise':             0.28,
  'Front Raise':               0.28,
  'Arnold Press':              0.55,
  'Shrugs':                    1.00,
  // Arms
  'Barbell Curl':              0.42,
  'Dumbbell Curl':             0.38,
  'Hammer Curl':               0.38,
  'Preacher Curl':             0.38,
  'Tricep Pushdown':           0.45,
  'Skull Crusher':             0.48,
  'Overhead Tricep Extension': 0.42,
  // Core (weighted)
  'Ab Wheel':                  0.30,
  'Hanging Leg Raise':         0.30,
  'Crunch':                    0.20,
  'Russian Twist':             0.25,
  'Cable Crunch':              0.40,
};

/* Exercises where the logged weight = ADDED weight only.
   Effective load = profile.weight + logged_weight.
   Log 0 kg for pure bodyweight; log 20 for +20 kg belt/vest. */
const BODYWEIGHT_EX = new Set([
  'Pull-up', 'Chin-up', 'Dips', 'Push-up',
]);

/* Push-ups only engage ~65% of bodyweight as resistance (the legs stay on the floor).
   Pull-ups/Chin-ups/Dips engage full bodyweight. */
const BW_FRACTION = {
  'Push-up': 0.65,
};

/* ═══════════════════════════════════════════
   RANK SYSTEM
   LBM-normalised, per-exercise + overall avg.

   SCORE FORMULA:
     score = (lifted_kg / (LBM^0.667 × ex_coeff)) × age_mult

   LBM (lean body mass) via Boer formula accounts for both height and weight,
   making a 190 cm / 90 kg lifter and a 170 cm / 60 kg lifter comparable.
   The allometric exponent 0.667 (= 2/3) reflects that strength scales with
   cross-sectional muscle area, not raw mass.
   The exercise coefficient normalises across movement patterns so every
   exercise is ranked on the same 0–13+ scale.

   RANK THRESHOLDS calibrated so:
     Gold ≈ consistent recreational gym-goer (~1 year training)
     Platinum ≈ intermediate lifter (~2–3 years)
     Diamond+ ≈ advanced / competitive
═══════════════════════════════════════════ */
const RANK_TIERS = [
  { id:'wood',     label:'Wood',     threshold:0    },
  { id:'iron',     label:'Iron',     threshold:1.2  },
  { id:'bronze',   label:'Bronze',   threshold:2.2  },
  { id:'silver',   label:'Silver',   threshold:3.2  },
  { id:'gold',     label:'Gold',     threshold:4.2  },
  { id:'platinum', label:'Platinum', threshold:5.4  },
  { id:'diamond',  label:'Diamond',  threshold:6.8  },
  { id:'champion', label:'Champion', threshold:8.5  },
  { id:'titan',    label:'Titan',    threshold:10.5 },
  { id:'god',      label:'God',      threshold:13.0 },
];

// Boer formula: lean body mass from weight (kg), height (cm), gender
function calcLBM(weight, height, gender) {
  if (!weight || !height) return Math.max(weight * 0.8, 20);
  if (gender === 'f') return 0.252*weight + 0.473*height - 48.3;
  return 0.407*weight + 0.267*height - 19.2; // male / default
}

// IPF Masters-inspired age multiplier — levels the field across age groups
function calcAgeMult(age) {
  if (!age) return 1.0;
  if (age < 20)  return 0.97;
  if (age < 35)  return 1.0;
  if (age < 40)  return 1.02;
  if (age < 45)  return 1.05;
  if (age < 50)  return 1.09;
  if (age < 55)  return 1.13;
  if (age < 60)  return 1.18;
  if (age < 65)  return 1.24;
  return 1.31;
}

// Epley 1RM estimate: weight × (1 + reps/repsCap).
// For weighted exercises cap at 30 (Epley breaks down at high reps).
// For BW exercises there's no cap — reps ARE the metric.
function calcEpley(weight, reps, repsCap) {
  if (!reps || reps <= 1) return weight;
  const cap = repsCap ?? 30;
  const r   = cap > 0 ? Math.min(reps, cap) : reps;
  return weight * (1 + r / 30);
}

// Normalised score for one exercise PR.
// pr = { weight, reps, sets, date }  (the full PR object)
// For bodyweight exercises: effective load = (profile.weight × BW_FRACTION + added_weight) × Epley(reps)
// Epley reps are uncapped for BW exercises so 50 push-ups scores higher than 10.
function calcExScore(pr, profile, exerciseName) {
  const lbm       = calcLBM(profile.weight, profile.height || 170, profile.gender || 'm');
  const coeff     = EX_COEFF[exerciseName] ?? 0.70;
  let baseWeight;
  let epleyCapVal;
  if (BODYWEIGHT_EX.has(exerciseName)) {
    const bwFrac = BW_FRACTION[exerciseName] ?? 1.0;
    baseWeight   = (profile.weight || 0) * bwFrac + (pr.weight || 0);
    epleyCapVal  = 0; // uncapped for BW reps exercises
  } else {
    baseWeight  = pr.weight || 0;
    epleyCapVal = 30;
  }
  const effective = calcEpley(baseWeight, pr.reps, epleyCapVal);
  return (effective / (Math.pow(Math.max(lbm, 20), 0.667) * coeff)) * calcAgeMult(profile.age);
}

const ROMAN = ['I', 'II', 'III'];

// Abbreviated tier names for small badges
const TIER_SHORT = {
  wood:'Wood', iron:'Iron', bronze:'Brz', silver:'Slv', gold:'Gold',
  platinum:'Plat', diamond:'Dia', champion:'Champ', titan:'Titan', god:'God',
};

function scoreToRankIdx(score) {
  let idx = 0;
  for (let i = 0; i < RANK_TIERS.length; i++) {
    if (score >= RANK_TIERS[i].threshold) idx = i;
  }
  return idx;
}

// Convert a score to tier index + division (1–3)
function scoreToTierDiv(score) {
  const tierIdx  = scoreToRankIdx(score);
  const tier     = RANK_TIERS[tierIdx];
  const nextTier = RANK_TIERS[tierIdx + 1];
  let divFrac;
  if (!nextTier) {
    // God tier: each division spans 1.5 score points above threshold
    divFrac = Math.min((score - tier.threshold) / 4.5, 0.9999);
  } else {
    divFrac = (score - tier.threshold) / (nextTier.threshold - tier.threshold);
  }
  const div = Math.min(Math.floor(divFrac * 3) + 1, 3);
  const pct = Math.round(((divFrac * 3) % 1) * 100);
  return { tierIdx, tier, div, pct };
}

// Convert a continuous avgIdx (0–9+) to tier + division
function avgIdxToTierDiv(avgIdx) {
  const tierIdx  = Math.min(Math.floor(avgIdx), RANK_TIERS.length - 1);
  const tierFrac = avgIdx - Math.floor(avgIdx);           // 0→1 within tier
  const div      = Math.min(Math.floor(tierFrac * 3) + 1, 3);
  const divFrac  = (tierFrac * 3) % 1;                   // 0→1 within division
  const pct      = Math.round(divFrac * 100);

  const isMaxDiv    = tierIdx === RANK_TIERS.length - 1 && div === 3;
  const nextTierIdx = tierIdx + (div === 3 ? 1 : 0);
  const nextDiv     = div === 3 ? 1 : div + 1;
  const nextTier    = RANK_TIERS[Math.min(nextTierIdx, RANK_TIERS.length - 1)];

  return { tier: RANK_TIERS[tierIdx], div, pct, nextTier, nextDiv, isMaxDiv };
}

// Overall rank = average of per-exercise rank indices
function calcOverallRank() {
  const p = db.profile;
  if (!p?.weight) return null;
  const prs = Object.entries(db.prs || {});
  if (!prs.length) return { ...avgIdxToTierDiv(0), count: 0 };
  const indices = prs.map(([name,pr]) => scoreToRankIdx(calcExScore(pr, p, name)));
  const avgIdx  = indices.reduce((a,b) => a+b, 0) / indices.length;
  return { ...avgIdxToTierDiv(avgIdx), count: prs.length };
}

/* ═══════════════════════════════════════════
   RENDER: HOME
═══════════════════════════════════════════ */
function renderHome() {
  renderRankCard();
  renderTodayCard();
  renderLastPerfCard();
}

function renderRankCard() {
  const el     = document.getElementById('rankCard');
  const result = calcOverallRank();

  if (!result) {
    el.innerHTML = `
      <div class="card-lbl">Strength Rank</div>
      <div class="rank-setup-prompt">Set your profile to unlock your rank — calculated from height, weight, and age.</div>
      <button class="rank-setup-btn" onclick="openProfile()">Set up profile →</button>`;
    return;
  }

  const { tier, div, pct, nextTier, nextDiv, isMaxDiv, count } = result;
  const subtitle  = count > 0 ? `Based on ${count} exercise${count > 1 ? 's' : ''}` : 'Log exercises to rank up';
  const divRoman  = ROMAN[div - 1];
  const curLabel  = `${tier.label} ${divRoman}`;
  const nextLabel = isMaxDiv ? 'God III · Max' : (div === 3 ? `${nextTier.label} I` : `${tier.label} ${ROMAN[div]}`);

  el.innerHTML = `
    <div class="card-lbl">Strength Rank</div>
    <div class="rank-card t-${tier.id}">
      <div class="rank-hex-wrap">
        <div class="rank-hex-bg"></div>
        <div class="rank-hex-inner">
          <span class="rank-hex-tier">${tier.label}</span>
          <span class="rank-hex-num">${divRoman}</span>
        </div>
      </div>
      <div class="rank-info">
        <div class="rank-name-lbl">${subtitle}</div>
        <div class="rank-name">${curLabel}</div>
        <div class="rank-progress-wrap">
          <div class="rank-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="rank-progress-lbl">
          <span>${curLabel}</span>
          <span>${nextLabel}</span>
        </div>
      </div>
    </div>`;
}

function renderTodayCard() {
  const el     = document.getElementById('todayCard');
  const key    = todayKey();
  const dayIdx = DAY_KEYS.indexOf(key);
  const exs    = db.schedule?.[key] || [];
  const tag    = db.dayTags?.[key];

  const tagHtml = tag
    ? `<span style="font-size:11px;color:var(--acc);font-weight:700;margin-left:6px;letter-spacing:.4px">${tag}</span>`
    : '';

  el.innerHTML = `<div class="card-lbl">Today · ${DAY_LONG[dayIdx]}${tagHtml}</div>`;

  if (!exs.length) {
    el.innerHTML += `<div class="card-empty">No session planned. Go to <strong>Week</strong> to set one up.</div>`;
    return;
  }

  exs.forEach(ex => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <span class="lr-name">${ex.name}</span>
      <span class="lr-meta">${fmtWeight(ex.weight, ex.name)} · ${ex.sets}×${ex.reps}</span>`;
    el.appendChild(row);
  });
}

function renderLastPerfCard() {
  const el  = document.getElementById('lastPerfCard');
  el.innerHTML = `<div class="card-lbl">Last Performances</div>`;

  const prs = Object.entries(db.prs||{})
    .sort((a,b) => (b[1].date||'').localeCompare(a[1].date||''))
    .slice(0, 5);

  if (!prs.length) {
    el.innerHTML += `<div class="card-empty">No performances yet. Log your first session.</div>`;
    return;
  }

  prs.forEach(([name, pr]) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <span class="lr-name">${name}</span>
      <div class="lr-right">
        <span class="lr-weight">${fmtWeight(pr.weight, name)}</span>
        <span class="lr-date">${fmtDate(pr.date)}</span>
      </div>`;
    el.appendChild(row);
  });
}

/* ═══════════════════════════════════════════
   RENDER: WEEK
═══════════════════════════════════════════ */
function renderWeek() {
  const list  = document.getElementById('weekList');
  list.innerHTML = '';
  const today = todayKey();

  DAY_KEYS.forEach((key, i) => {
    const exs     = db.schedule?.[key] || [];
    const isToday = key === today;
    const wasOpen = list.querySelector(`[data-day="${key}"]`)?.classList.contains('open');

    const row = document.createElement('div');
    row.className = 'day-row' + (isToday || wasOpen ? ' open' : '');
    row.dataset.day = key;

    const dotClass = isToday ? 'today' : (exs.length ? 'filled' : '');
    const exLabel  = exs.length ? `${exs.length} exercise${exs.length>1?'s':''}` : 'No exercises';
    const tag      = db.dayTags?.[key];
    const tagChip  = tag
      ? `<button class="day-tag-chip" data-day="${key}">${tag}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`
      : `<button class="day-tag-chip add" data-day="${key}">+ Focus<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;

    row.innerHTML = `
      <div class="day-hdr">
        <div class="day-indicator ${dotClass}"></div>
        <div class="day-label-wrap">
          <div class="day-label${isToday?' today':''}">${DAY_LONG[i]}</div>
          <div class="day-tag-row">${tagChip}<span class="day-count-lbl" style="margin-top:0">${exLabel}</span></div>
        </div>
        <span class="day-chevron">▾</span>
      </div>
      <div class="day-body" id="body-${key}"></div>`;

    row.querySelector('.day-hdr').addEventListener('click', () => {
      row.classList.toggle('open');
    });

    row.querySelector('.day-tag-chip').addEventListener('click', e => {
      e.stopPropagation();
      openTagModal(key, i);
    });

    list.appendChild(row);

    const body = document.getElementById('body-'+key);
    exs.forEach(ex => {
      const item = document.createElement('div');
      item.className = 'day-ex-item';
      item.innerHTML = `
        <div class="day-ex-info">
          <div class="day-ex-name">${ex.name}</div>
          <div class="day-ex-sub">${fmtWeight(ex.weight, ex.name)} · ${ex.sets} sets × ${ex.reps} reps</div>
        </div>
        <div class="day-ex-actions">
          <button class="tiny-btn edit-ex" data-day="${key}" data-id="${ex.id}">✏️</button>
          <button class="tiny-btn del-ex"  data-day="${key}" data-id="${ex.id}">🗑️</button>
        </div>`;

      item.querySelector('.edit-ex').addEventListener('click', e => {
        e.stopPropagation();
        openExModal(key, ex.id);
      });

      item.querySelector('.del-ex').addEventListener('click', e => {
        e.stopPropagation();
        deleteEx(key, ex.id);
      });

      body.appendChild(item);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'add-ex-row';
    addBtn.innerHTML = '＋ Add Exercise';
    addBtn.addEventListener('click', () => openExModal(key, null));
    body.appendChild(addBtn);
  });
}

function deleteEx(dayKey, id) {
  if (!db.schedule[dayKey]) return;
  db.schedule[dayKey] = db.schedule[dayKey].filter(e => e.id !== id);
  persist();
  renderWeek();
  renderHome();
  showToast('Exercise removed');
}

/* ═══════════════════════════════════════════
   RENDER: RECORDS
═══════════════════════════════════════════ */
function renderRecords() {
  const list   = document.getElementById('recList');
  const sorted = Object.entries(db.prs||{})
    .sort((a,b) => (b[1].date||'').localeCompare(a[1].date||''));

  if (!sorted.length) {
    list.innerHTML = `<div class="empty-state"><b>No records yet</b>Log exercises in the Week tab — PRs appear here automatically.</div>`;
    return;
  }

  list.innerHTML = '';
  sorted.forEach(([name, pr]) => {
    const p = db.profile;
    let badgeHtml = '';
    if (p?.weight) {
      const { tier, div } = scoreToTierDiv(calcExScore(pr, p, name));
      badgeHtml = `<span class="rec-rank-badge t-${tier.id}">${TIER_SHORT[tier.id]} ${ROMAN[div-1]}</span>`;
    }
    const el = document.createElement('div');
    el.className = 'rec-item';
    el.innerHTML = `
      <span class="rec-name">${name}</span>
      <div class="rec-right">
        <div class="rec-right-top">
          ${badgeHtml}
          <span class="rec-weight">${fmtWeight(pr.weight, name)}</span>
        </div>
        <span class="rec-meta">${pr.sets}×${pr.reps} · ${fmtDate(pr.date)}</span>
      </div>`;
    list.appendChild(el);
  });
}

/* ═══════════════════════════════════════════
   EXERCISE MODAL
═══════════════════════════════════════════ */
let exModalDay = null;
let exModalId  = null;
let exSelName  = '';
let exWeight   = 60;
let exSets     = 3;
let exReps     = 8;

function openExModal(dayKey, exId) {
  exModalDay = dayKey;
  exModalId  = exId;
  exSelName  = '';

  if (exId) {
    const ex = (db.schedule?.[dayKey]||[]).find(e => e.id === exId);
    if (ex) {
      exSelName = ex.name;
      exWeight  = ex.weight;
      exSets    = ex.sets;
      exReps    = ex.reps;
    }
    document.getElementById('exSheetTitle').textContent = 'Edit Exercise';
  } else {
    exWeight = 60; exSets = 3; exReps = 8;
    document.getElementById('exSheetTitle').textContent = 'Add Exercise';
  }

  document.getElementById('exSearch').value = exSelName;
  updateWeightLabel();
  updateWeightDisplay();
  document.getElementById('setsVal').textContent = exSets;
  document.getElementById('repsVal').textContent = exReps;

  buildPicker('');
  document.getElementById('exInputBlock').style.display = exSelName ? 'block' : 'none';
  if (exSelName) document.getElementById('exSelectedLbl').textContent = exSelName;

  document.getElementById('exOverlay').classList.add('open');
  setTimeout(() => document.getElementById('exSearch').focus(), 320);
}

function buildPicker(query) {
  const container = document.getElementById('exPickerList');
  container.innerHTML = '';
  const q = query.toLowerCase().trim();

  if (q) {
    const all = Object.values(EX_DB).flat().filter(n => n.toLowerCase().includes(q));
    if (!all.length) {
      const msg = document.createElement('div');
      msg.style.cssText = 'font-size:13px;color:var(--text3);padding:6px 0 10px';
      msg.textContent = 'No match — tap Save to use this as a custom exercise.';
      container.appendChild(msg);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'pills';
      all.slice(0,12).forEach(n => {
        const p = document.createElement('div');
        p.className = 'pill' + (n===exSelName?' active':'');
        p.textContent = n;
        p.addEventListener('click', () => selectEx(n));
        wrap.appendChild(p);
      });
      container.appendChild(wrap);
    }
  } else {
    Object.entries(EX_DB).forEach(([cat, exs]) => {
      const lbl = document.createElement('div');
      lbl.className = 'cat-label';
      lbl.textContent = cat;
      container.appendChild(lbl);
      const wrap = document.createElement('div');
      wrap.className = 'pills';
      exs.forEach(n => {
        const p = document.createElement('div');
        p.className = 'pill' + (n===exSelName?' active':'');
        p.textContent = n;
        p.addEventListener('click', () => selectEx(n));
        wrap.appendChild(p);
      });
      container.appendChild(wrap);
    });
  }
}

function selectEx(name) {
  exSelName = name;
  document.getElementById('exSearch').value = name;
  document.getElementById('exSelectedLbl').textContent = name;
  document.getElementById('exInputBlock').style.display = 'block';
  // Reset to 0 for BW exercises so default is bodyweight-only
  if (BODYWEIGHT_EX.has(name) && !exModalId) {
    exWeight = 0;
  }
  updateWeightLabel();
  updateWeightDisplay();
  buildPicker('');
}

function updateWeightLabel() {
  const lbl = document.getElementById('weightLbl');
  if (!lbl) return;
  lbl.textContent = BODYWEIGHT_EX.has(exSelName) ? 'Added Weight (0 = bodyweight only)' : 'Weight';
}

// Returns a human-readable weight string for display.
// BW exercises: 0 → "BW", 20 → "+20 kg". Others: "60 kg".
function fmtWeight(weight, exerciseName) {
  if (BODYWEIGHT_EX.has(exerciseName)) {
    return weight === 0 ? 'BW' : `+${weight} kg`;
  }
  return `${weight} kg`;
}

function updateWeightDisplay() {
  const isBW = BODYWEIGHT_EX.has(exSelName);
  const hint = isBW
    ? `<small>${exWeight === 0 ? 'bodyweight only' : `+${exWeight} kg over BW`}</small>`
    : `<small> kg</small>`;
  document.getElementById('weightBig').innerHTML = isBW
    ? (exWeight === 0 ? `BW${hint}` : `+${exWeight}${hint}`)
    : `${exWeight}${hint}`;
  document.getElementById('weightSlider').value = exWeight;
}

document.getElementById('exSearch').addEventListener('input', e => {
  buildPicker(e.target.value);
  if (!e.target.value) {
    exSelName = '';
    document.getElementById('exInputBlock').style.display = 'none';
  }
});

document.getElementById('weightSlider').addEventListener('input', e => {
  exWeight = parseFloat(e.target.value);
  updateWeightDisplay();
});

document.getElementById('wMinus').addEventListener('click', () => {
  exWeight = Math.max(0, exWeight - 2.5);
  updateWeightDisplay();
});

document.getElementById('wPlus').addEventListener('click', () => {
  exWeight = Math.min(500, exWeight + 2.5);
  updateWeightDisplay();
});

document.getElementById('setsMinus').addEventListener('click', () => {
  exSets = Math.max(1, exSets - 1);
  document.getElementById('setsVal').textContent = exSets;
});
document.getElementById('setsPlus').addEventListener('click', () => {
  exSets = Math.min(20, exSets + 1);
  document.getElementById('setsVal').textContent = exSets;
});
document.getElementById('repsMinus').addEventListener('click', () => {
  exReps = Math.max(1, exReps - 1);
  document.getElementById('repsVal').textContent = exReps;
});
document.getElementById('repsPlus').addEventListener('click', () => {
  exReps = Math.min(100, exReps + 1);
  document.getElementById('repsVal').textContent = exReps;
});

document.getElementById('exSave').addEventListener('click', () => {
  const name = (exSelName || document.getElementById('exSearch').value).trim();
  if (!name) { showToast('Choose or type an exercise name'); return; }

  if (!db.schedule[exModalDay]) db.schedule[exModalDay] = [];

  const entry = { id: exModalId || uid(), name, weight: exWeight, sets: exSets, reps: exReps };

  if (exModalId) {
    db.schedule[exModalDay] = db.schedule[exModalDay].map(e => e.id===exModalId ? entry : e);
  } else {
    db.schedule[exModalDay].push(entry);
  }

  // Update PR based on best estimated 1RM (Epley), accounting for bodyweight exercises.
  // This lets 15 reps @ bodyweight beat 3 reps @ same weight if the 1RM estimate is higher.
  const pr         = db.prs[name];
  const bw          = db.profile?.weight || 0;
  const isBWEx      = BODYWEIGHT_EX.has(name);
  const bwFrac      = BW_FRACTION[name] ?? 1.0;
  const epCap       = isBWEx ? 0 : 30;
  const baseNew     = isBWEx ? bw * bwFrac + exWeight : exWeight;
  const baseOld     = pr ? (isBWEx ? bw * bwFrac + pr.weight : pr.weight) : 0;
  const new1RM      = calcEpley(baseNew, exReps, epCap);
  const old1RM      = pr ? calcEpley(baseOld, pr.reps, epCap) : 0;
  const isPR       = new1RM > old1RM;
  if (isPR) {
    db.prs[name] = { weight: exWeight, sets: exSets, reps: exReps, date: new Date().toISOString() };
  }

  persist();
  closeExModal();
  renderWeek();
  renderHome();
  renderRecords();
  if (isPR) {
    showToast('New PR recorded!');
    const fmtW = fmtWeight(exWeight, name);
    fireNotif('New Personal Record!', `${name} — ${fmtW} × ${exReps} reps. Keep pushing!`, '🏆');
  } else {
    showToast('Exercise saved');
  }
});

function closeExModal() {
  document.getElementById('exOverlay').classList.remove('open');
  exModalDay = null; exModalId = null; exSelName = '';
}

document.getElementById('exClose').addEventListener('click', closeExModal);
document.getElementById('exOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('exOverlay')) closeExModal();
});

/* ═══════════════════════════════════════════
   PROFILE MODAL
═══════════════════════════════════════════ */
let selectedGender = 'm';

function selectGender(g) {
  selectedGender = g;
  document.getElementById('gBtnM').classList.toggle('active', g === 'm');
  document.getElementById('gBtnF').classList.toggle('active', g === 'f');
}

function openProfile() {
  document.getElementById('inWeight').value = db.profile?.weight || '';
  document.getElementById('inHeight').value = db.profile?.height || '';
  document.getElementById('inAge').value    = db.profile?.age    || '';
  selectedGender = db.profile?.gender || 'm';
  document.getElementById('gBtnM').classList.toggle('active', selectedGender === 'm');
  document.getElementById('gBtnF').classList.toggle('active', selectedGender === 'f');
  document.getElementById('profileOverlay').classList.add('open');
}

function closeProfile() {
  document.getElementById('profileOverlay').classList.remove('open');
}

document.getElementById('btnProfile').addEventListener('click', openProfile);
document.getElementById('profileClose').addEventListener('click', closeProfile);
document.getElementById('profileOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('profileOverlay')) closeProfile();
});

document.getElementById('profileSave').addEventListener('click', () => {
  const w = parseFloat(document.getElementById('inWeight').value);
  const h = parseFloat(document.getElementById('inHeight').value);
  const a = parseInt(document.getElementById('inAge').value);
  if (!w || w < 30)             { showToast('Enter a valid weight (30–200 kg)'); return; }
  if (!h || h < 140 || h > 220) { showToast('Enter a valid height (140–220 cm)'); return; }
  db.profile.weight = w;
  db.profile.height = h;
  db.profile.age    = a || null;
  db.profile.gender = selectedGender;
  persist();
  closeProfile();
  renderHome();
  renderRecords();
  showToast('Profile saved');
});

/* ═══════════════════════════════════════════
   REST TIMER (dedicated screen)
═══════════════════════════════════════════ */
const RING_CIRC = 553; // 2π × 88

let timerTotal    = 0;
let timerLeft     = 0;
let timerInterval = null;
let timerRunning  = false;
let timerPresetName = '';

function fmtTime(s) {
  const m = Math.floor(s/60);
  return `${m}:${String(s%60).padStart(2,'0')}`;
}

function updateTimerRing() {
  const numEl  = document.getElementById('timerBigNum');
  const fillEl = document.getElementById('trFill');
  if (!numEl || !fillEl) return;
  const pct    = timerTotal > 0 ? timerLeft / timerTotal : 1;
  const urgent = timerLeft <= 10 && timerRunning;
  numEl.textContent = timerTotal > 0 ? fmtTime(timerLeft) : '—:——';
  numEl.classList.toggle('urgent', urgent);
  fillEl.style.strokeDashoffset = RING_CIRC * (1 - pct);
  fillEl.classList.toggle('urgent', urgent);
}

document.querySelectorAll('.tpc').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.tpc').forEach(c => c.classList.remove('sel'));
    card.classList.add('sel');
    const sec  = parseInt(card.dataset.sec);
    timerPresetName = card.dataset.name;
    timerTotal = sec;
    timerLeft  = sec;
    timerRunning = false;
    clearInterval(timerInterval);
    document.getElementById('timerPanel').style.display = 'flex';
    document.getElementById('timerBigLbl').textContent = timerPresetName;
    document.getElementById('tcbPause').textContent = 'Start';
    updateTimerRing();
    // Auto-start
    startTimer();
  });
});

function startTimer() {
  if (timerLeft <= 0) timerLeft = timerTotal;
  timerRunning = true;
  document.getElementById('tcbPause').textContent = 'Pause';
  // Tell service worker to schedule a notification
  scheduleTimerNotif(timerLeft, timerPresetName);
  timerInterval = setInterval(() => {
    timerLeft--;
    updateTimerRing();
    if (timerLeft <= 0) {
      clearInterval(timerInterval);
      timerRunning = false;
      document.getElementById('tcbPause').textContent = 'Start';
      showToast('Rest done — go!');
      if (navigator.vibrate) navigator.vibrate([200,100,200]);
      fireNotif('Rest done!', `${timerPresetName} complete. Time to lift.`, '⏱️');
      cancelTimerNotif();
    }
  }, 1000);
}

document.getElementById('tcbPause').addEventListener('click', () => {
  if (!timerTotal) { showToast('Select a preset first'); return; }
  if (timerRunning) {
    clearInterval(timerInterval);
    timerRunning = false;
    document.getElementById('tcbPause').textContent = 'Resume';
    cancelTimerNotif();
  } else {
    startTimer();
  }
});

document.getElementById('tcbReset').addEventListener('click', () => {
  clearInterval(timerInterval);
  timerRunning = false;
  timerLeft    = timerTotal;
  document.getElementById('tcbPause').textContent = 'Start';
  updateTimerRing();
  cancelTimerNotif();
});

/* ═══════════════════════════════════════════
   DAY FOCUS TAGS
═══════════════════════════════════════════ */
const TAG_SUGGESTIONS = [
  'Chest + Back', 'Push Day', 'Pull Day', 'Leg Day',
  'Upper Body', 'Lower Body', 'Shoulders + Arms', 'Full Body', 'Rest Day',
];

let tagModalDay = null;

function openTagModal(dayKey, dayIdx) {
  tagModalDay = dayKey;
  document.getElementById('tagSheetTitle').textContent = `${DAY_LONG[dayIdx]} Focus`;
  document.getElementById('tagInput').value = db.dayTags?.[dayKey] || '';

  const sug = document.getElementById('tagSuggestions');
  sug.innerHTML = '';
  TAG_SUGGESTIONS.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'tag-sug';
    btn.textContent = t;
    btn.addEventListener('click', () => {
      document.getElementById('tagInput').value = t;
    });
    sug.appendChild(btn);
  });

  document.getElementById('tagOverlay').classList.add('open');
  setTimeout(() => document.getElementById('tagInput').focus(), 320);
}

function closeTagModal() {
  document.getElementById('tagOverlay').classList.remove('open');
  tagModalDay = null;
}

document.getElementById('tagClose').addEventListener('click', closeTagModal);
document.getElementById('tagOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('tagOverlay')) closeTagModal();
});

document.getElementById('tagSave').addEventListener('click', () => {
  const val = document.getElementById('tagInput').value.trim();
  if (!db.dayTags) db.dayTags = {};
  if (val) db.dayTags[tagModalDay] = val;
  else delete db.dayTags[tagModalDay];
  persist();
  closeTagModal();
  renderWeek();
  renderHome();
  showToast(val ? 'Focus saved' : 'Focus cleared');
});

document.getElementById('tagClear').addEventListener('click', () => {
  if (!db.dayTags) db.dayTags = {};
  delete db.dayTags[tagModalDay];
  persist();
  closeTagModal();
  renderWeek();
  renderHome();
  showToast('Focus cleared');
});

/* ═══════════════════════════════════════════
   NOTIFICATIONS
═══════════════════════════════════════════ */
function updateNotifBtn() {
  const btn = document.getElementById('btnNotif');
  const on  = Notification.permission === 'granted' && db.notif?.enabled;
  btn.classList.toggle('active', on);
}

document.getElementById('btnNotif').addEventListener('click', async () => {
  if (Notification.permission === 'granted' && db.notif?.enabled) {
    if (!db.notif) db.notif = {};
    db.notif.enabled = false;
    persist();
    updateNotifBtn();
    showToast('Notifications off');
    return;
  }
  if (!('Notification' in window)) { showToast('Not supported on this browser'); return; }
  if (Notification.permission === 'denied') { showToast('Blocked — enable in browser settings'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { showToast('Permission not granted'); return; }
  if (!db.notif) db.notif = {};
  db.notif.enabled = true;
  persist();
  updateNotifBtn();
  showToast('Notifications enabled!');
  scheduleDailyReminder();
});

function fireNotif(title, body) {
  if (Notification.permission !== 'granted' || !db.notif?.enabled) return;
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'SHOW_NOTIF', title, body });
  } catch { /* ignore on unsupported platforms */ }
}

function scheduleTimerNotif(seconds, presetName) {
  if (Notification.permission !== 'granted' || !db.notif?.enabled) return;
  navigator.serviceWorker?.controller?.postMessage({
    type: 'SCHEDULE_TIMER',
    endsAt: Date.now() + seconds * 1000,
    presetName,
  });
}

function cancelTimerNotif() {
  navigator.serviceWorker?.controller?.postMessage({ type: 'CANCEL_TIMER' });
}

function scheduleDailyReminder() {
  if (Notification.permission !== 'granted' || !db.notif?.enabled) return;
  const now  = new Date();
  const next = new Date(now);
  next.setHours(10, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(fireDailyReminder, next.getTime() - now.getTime());
}

function fireDailyReminder() {
  const key = todayKey();
  const tag = db.dayTags?.[key];
  const exs = db.schedule?.[key] || [];
  if (tag || exs.length) {
    const body = tag
      ? `Today is ${tag} — ${exs.length} exercise${exs.length !== 1 ? 's' : ''} planned.`
      : `You have ${exs.length} exercise${exs.length !== 1 ? 's' : ''} planned today.`;
    fireNotif('Time to train 💪', body);
  }
  scheduleDailyReminder();
}

function checkMissedReminder() {
  if (Notification.permission !== 'granted' || !db.notif?.enabled) return;
  const key = todayKey();
  const tag = db.dayTags?.[key];
  const exs = db.schedule?.[key] || [];
  if (!tag && !exs.length) return;
  const body = tag
    ? `Today is ${tag} — ${exs.length} exercise${exs.length !== 1 ? 's' : ''} planned.`
    : `You have ${exs.length} exercise${exs.length !== 1 ? 's' : ''} planned today.`;
  fireNotif('Time to train 💪', body);
}

/* ═══════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════ */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.scr;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(target).classList.add('active');
    btn.classList.add('active');

    if (target === 'scr-week')  renderWeek();
    if (target === 'scr-rec')   renderRecords();
    if (target === 'scr-timer') updateTimerRing();
  });
});

/* ═══════════════════════════════════════════
   TOAST
═══════════════════════════════════════════ */
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  if (toastTimer) clearTimeout(toastTimer);
  t.classList.add('show');
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
renderHome();
updateNotifBtn();
scheduleDailyReminder();
checkMissedReminder();

// iOS install tip (shown once)
const isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.navigator.standalone === true;
if (isIOS && !isStandalone && !localStorage.getItem('gymlog_tip')) {
  setTimeout(() => {
    showToast('📲 Safari → Share → Add to Home Screen');
    localStorage.setItem('gymlog_tip', '1');
  }, 2000);
}
