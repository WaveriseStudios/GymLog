/* ═══════════════════════════════════════════
   DATA
═══════════════════════════════════════════ */
const STORE = 'gymlog_v4';

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || defDB(); }
  catch { return defDB(); }
}

function defDB() {
  return { profile: { name: '', weight: null, height: null, age: null, gender: 'm' }, schedule: {}, prs: {}, history: [], dayTags: {}, notif: { enabled: false } };
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
const EX_MUSCLE = {
  'Bench Press':'Chest',       'Incline Bench Press':'Chest',  'Decline Bench Press':'Chest',
  'Dumbbell Fly':'Chest',      'Cable Fly':'Chest',            'Dips':'Chest',      'Push-up':'Chest',
  'Deadlift':'Back',           'Pull-up':'Back',               'Chin-up':'Back',
  'Barbell Row':'Back',        'Lat Pulldown':'Back',          'Seated Row':'Back',
  'T-Bar Row':'Back',          'Face Pull':'Back',
  'Squat':'Legs',              'Front Squat':'Legs',           'Leg Press':'Legs',
  'Romanian Deadlift':'Legs',  'Leg Extension':'Legs',         'Leg Curl':'Legs',
  'Hip Thrust':'Legs',         'Calf Raise':'Legs',            'Hack Squat':'Legs',
  'Overhead Press':'Shoulders','Dumbbell Shoulder Press':'Shoulders','Lateral Raise':'Shoulders',
  'Front Raise':'Shoulders',   'Arnold Press':'Shoulders',     'Shrugs':'Shoulders',
  'Barbell Curl':'Arms',       'Dumbbell Curl':'Arms',         'Hammer Curl':'Arms',
  'Preacher Curl':'Arms',      'Tricep Pushdown':'Arms',       'Skull Crusher':'Arms',
  'Overhead Tricep Extension':'Arms',
  'Ab Wheel':'Core',           'Hanging Leg Raise':'Core',     'Crunch':'Core',
  'Russian Twist':'Core',      'Cable Crunch':'Core',
};

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

// Overall rank = average of raw per-exercise scores → scoreToTierDiv
// (averaging tier indices loses within-tier position and produces wrong results)
function calcOverallRank() {
  const p = db.profile;
  if (!p?.weight) return null;
  const prs = Object.entries(db.prs || {});
  if (!prs.length) return null;

  const scores   = prs.map(([name, pr]) => calcExScore(pr, p, name));
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const { tierIdx, tier, div, pct } = scoreToTierDiv(avgScore);

  const isMaxDiv    = tierIdx === RANK_TIERS.length - 1 && div === 3;
  const nextTierIdx = tierIdx + (div === 3 ? 1 : 0);
  const nextDiv     = div === 3 ? 1 : div + 1;
  const nextTier    = RANK_TIERS[Math.min(nextTierIdx, RANK_TIERS.length - 1)];

  return { tier, div, pct, nextTier, nextDiv, isMaxDiv, count: prs.length };
}

// Rough gym-population percentile for each of the 30 rank steps.
// Calibrated so Gold I ≈ top 45% (consistent 1-year gym-goer).
const STEP_PERCENTILE = [
   2,  4,  6,   // Wood I–III
   9, 12, 16,   // Iron I–III
  20, 25, 30,   // Bronze I–III
  36, 42, 48,   // Silver I–III
  54, 60, 65,   // Gold I–III
  70, 75, 80,   // Platinum I–III
  84, 87, 90,   // Diamond I–III
  92, 94, 95,   // Champion I–III
  96, 97, 98,   // Titan I–III
  98.5, 99, 99.5, // God I–III
];

function rankStepToPercentile(step) {
  return STEP_PERCENTILE[Math.min(step, 29)];
}

/* ═══════════════════════════════════════════
   STREAK
═══════════════════════════════════════════ */
function calcStreak() {
  const history = db.history || [];
  if (!history.length) return 0;
  const dayMs = 86400000;
  const todayMs = new Date().setHours(0,0,0,0);
  const daySet = new Set(history.map(h => new Date(h.date).setHours(0,0,0,0)));
  let streak = 0;
  let check = daySet.has(todayMs) ? todayMs : todayMs - dayMs;
  while (daySet.has(check)) { streak++; check -= dayMs; }
  return streak;
}

/* ═══════════════════════════════════════════
   RENDER: HOME
═══════════════════════════════════════════ */
function renderHome() {
  // Date label
  const now = new Date();
  const DAYS  = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateLbl = document.getElementById('homeDateLbl');
  if (dateLbl) dateLbl.textContent = `${DAYS[now.getDay()]} · ${MONTHS[now.getMonth()]} ${now.getDate()}`;

  // Streak
  const streak = calcStreak();
  const streakEl = document.getElementById('streakChip');
  if (streakEl) {
    if (streak > 0) {
      streakEl.textContent = `🔥 ${streak}`;
      streakEl.style.display = '';
    } else {
      streakEl.style.display = 'none';
    }
  }

  // Greeting
  const hour = now.getHours();
  const greetTime = hour < 12 ? 'Good morning,' : hour < 17 ? 'Good afternoon,' : 'Good evening,';
  const subEl = document.getElementById('greetSub');
  const nameEl = document.getElementById('greetName');
  if (subEl) subEl.textContent = greetTime;
  if (nameEl) {
    const n = db.profile?.name?.trim();
    nameEl.textContent = n ? n + '.' : 'Athlete.';
  }

  // Avatar initial
  const avBtn = document.getElementById('btnProfile');
  if (avBtn) {
    const n = db.profile?.name?.trim();
    avBtn.textContent = n ? n[0].toUpperCase() : 'G';
  }

  renderRankCard();
  renderTodayCard();
  renderQuickLog();
}

function renderRankCard() {
  const el     = document.getElementById('rankCard');
  const result = calcOverallRank();

  if (!result) {
    el.innerHTML = `<div style="padding:14px">
      <div class="lbl" style="margin-bottom:10px">Strength Rank</div>
      <div class="rank-setup-prompt">Set your profile to unlock your rank — calculated from height, weight, and age.</div>
      <button class="rank-setup-btn" onclick="openProfile()">Set up profile →</button>
    </div>`;
    return;
  }

  const { tier, div, pct, nextTier, nextDiv, isMaxDiv, count } = result;
  const subtitle   = count > 0 ? `Based on ${count} exercise${count > 1 ? 's' : ''}` : 'Log exercises to rank up';
  const divRoman   = ROMAN[div - 1];
  const curLabel   = `${tier.label} ${divRoman}`;
  const nextLabel  = isMaxDiv ? 'God III · Max' : (div === 3 ? `${nextTier.label} I` : `${tier.label} ${ROMAN[div]}`);
  const step       = tierDivToStep(tier, div);
  const percentile = rankStepToPercentile(step);
  const pctText    = percentile >= 99 ? `top 1% of gym-goers` : `better than ${Math.round(percentile)}% of people that go to the gym`;

  el.innerHTML = `
    <div class="lbl">Strength Rank</div>
    <div class="rank-card t-${tier.id}" id="rankCardInner" style="cursor:pointer">
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
        <div class="rank-percentile">You are ${pctText}</div>
        <div class="rank-progress-wrap">
          <div class="rank-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="rank-progress-lbl">
          <span>${curLabel}</span>
          <span>${nextLabel}</span>
        </div>
      </div>
      <div class="rank-tap-hint">Tap for breakdown →</div>
    </div>`;

  document.getElementById('rankCardInner').addEventListener('click', openRankBreakdown);
}

// Returns 0-based step index out of 29 total steps (10 tiers × 3 divs - 1)
function tierDivToStep(tier, div) {
  const tierIdx = RANK_TIERS.findIndex(t => t.id === tier.id);
  return tierIdx * 3 + (div - 1);
}

const TIER_COLORS = {
  wood:'#4a6070', iron:'#7a8fa0', bronze:'#c2703a', silver:'#a8bec8',
  gold:'#e0a020', platinum:'#007ea7', diamond:'#00a8e8',
  champion:'#9d174d', titan:'#dc2626', god:'#f59e0b',
};

// 5×2 badge grid — no scrolling, shield-style SVG per tier
function buildRankTimeline(markerStep) {
  const activeTierIdx = Math.floor(markerStep / 3);
  const activeDiv     = (markerStep % 3) + 1;

  // Shield SVG path: pointed bottom, flat top with slight curve
  const SHIELD = 'M30,3 L55,14 L55,38 Q55,58 30,65 Q5,58 5,38 L5,14 Z';

  // Wing paths for higher tiers (Diamond+)
  const WINGS = 'M5,26 C0,22 -4,28 -2,34 L5,32 Z M55,26 C60,22 64,28 62,34 L55,32 Z';

  const badges = RANK_TIERS.map((t, ti) => {
    const isPast   = ti < activeTierIdx;
    const isActive = ti === activeTierIdx;
    const isFuture = ti > activeTierIdx;
    const color    = TIER_COLORS[t.id];
    const hasWings = ti >= 6; // Diamond+

    const fillOpacity  = isActive ? '1' : isPast ? '0.35' : '0.12';
    const strokeOpacity = isFuture ? '0.3' : '1';
    const textOpacity  = isFuture ? '0.35' : '1';
    const glow = isActive ? `filter:drop-shadow(0 0 8px ${color}cc)` : '';

    const pips = [1,2,3].map(d => {
      const filled = isPast || (isActive && d <= activeDiv);
      const cur    = isActive && d === activeDiv;
      return `<span class="rlt-pip${filled?' filled':''}${cur?' cur':''}"
                    style="${filled?`background:${color};border-color:${color}`:''}"></span>`;
    }).join('');

    const wingSvg = hasWings
      ? `<path d="${WINGS}" fill="${color}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-opacity="${strokeOpacity}" stroke-width="1.5" stroke-linejoin="round"/>`
      : '';

    return `<div class="rlt-cell${isActive?' active':''}">
      <svg class="rlt-shield-svg" viewBox="-6 0 72 68" xmlns="http://www.w3.org/2000/svg" style="${glow}">
        ${wingSvg}
        <path d="${SHIELD}" fill="${color}" fill-opacity="${fillOpacity}"
              stroke="${color}" stroke-opacity="${strokeOpacity}" stroke-width="2" stroke-linejoin="round"/>
        <text x="30" y="37" text-anchor="middle" dominant-baseline="central"
              font-family="Barlow Condensed,sans-serif" font-size="22" font-weight="900"
              fill="${isActive?'#fff':color}" fill-opacity="${textOpacity}">${t.label[0]}</text>
      </svg>
      <div class="rlt-cell-name" style="color:${isActive?color:isFuture?'var(--text3)':color};opacity:${isFuture?0.4:1}">${t.label}</div>
      <div class="rlt-pips">${pips}</div>
    </div>`;
  }).join('');

  return `<div class="rlt-grid">${badges}</div>`;
}

// REMOVED: body SVG replaced by muscle group rows
function buildBodySVG_UNUSED(groups) {
  const gc = g => groups[g] ? TIER_COLORS[groups[g].tier.id] : null;
  const NONE = '#3a3f44';

  // Silhouette base pieces shared by both views, dx = center x
  function silhouette(dx) {
    return `
      <ellipse cx="${dx}" cy="16" rx="14" ry="16" fill="#454c52"/>
      <rect x="${dx-5}" y="30" width="10" height="13" rx="3" fill="#454c52"/>
      <path d="M${dx-36},43 C${dx-46},46 ${dx-47},56 ${dx-46},68 L${dx-46},103 Q${dx-36},116 ${dx},118 Q${dx+36},116 ${dx+46},103 L${dx+46},68 C${dx+47},56 ${dx+46},46 ${dx+36},43 Z" fill="#454c52"/>
      <path d="M${dx-36},105 Q${dx-30},132 ${dx-24},136 L${dx+24},136 Q${dx+30},132 ${dx+36},105 Z" fill="#454c52"/>
      <rect x="${dx-53}" y="44" width="13" height="62" rx="6" fill="#454c52"/>
      <rect x="${dx+40}" y="44" width="13" height="62" rx="6" fill="#454c52"/>
      <rect x="${dx-51}" y="106" width="11" height="58" rx="5" fill="#343a3f"/>
      <rect x="${dx+40}" y="106" width="11" height="58" rx="5" fill="#343a3f"/>
      <ellipse cx="${dx-45}" cy="167" rx="8" ry="7" fill="#343a3f"/>
      <ellipse cx="${dx+45}" cy="167" rx="8" ry="7" fill="#343a3f"/>
      <rect x="${dx-33}" y="136" width="24" height="90" rx="10" fill="#454c52"/>
      <rect x="${dx+9}"  y="136" width="24" height="90" rx="10" fill="#454c52"/>
      <rect x="${dx-31}" y="226" width="20" height="66" rx="7" fill="#343a3f"/>
      <rect x="${dx+11}" y="226" width="20" height="66" rx="7" fill="#343a3f"/>
      <ellipse cx="${dx-21}" cy="294" rx="14" ry="7" fill="#343a3f"/>
      <ellipse cx="${dx+21}" cy="294" rx="14" ry="7" fill="#343a3f"/>`;
  }

  // Front muscle zones
  function frontZones(dx) {
    return [
      gc('Chest') ? `<ellipse cx="${dx-13}" cy="62" rx="17" ry="21" fill="${gc('Chest')}" opacity="0.88"/>
                     <ellipse cx="${dx+13}" cy="62" rx="17" ry="21" fill="${gc('Chest')}" opacity="0.88"/>` : '',
      gc('Shoulders') ? `<ellipse cx="${dx-46}" cy="56" rx="12" ry="18" fill="${gc('Shoulders')}" opacity="0.88"/>
                         <ellipse cx="${dx+46}" cy="56" rx="12" ry="18" fill="${gc('Shoulders')}" opacity="0.88"/>` : '',
      gc('Arms') ? `<ellipse cx="${dx-47}" cy="78" rx="7" ry="20" fill="${gc('Arms')}" opacity="0.88"/>
                    <ellipse cx="${dx+47}" cy="78" rx="7" ry="20" fill="${gc('Arms')}" opacity="0.88"/>` : '',
      gc('Core') ? `<ellipse cx="${dx}" cy="96" rx="13" ry="20" fill="${gc('Core')}" opacity="0.88"/>` : '',
      gc('Legs') ? `<ellipse cx="${dx-21}" cy="172" rx="12" ry="36" fill="${gc('Legs')}" opacity="0.88"/>
                    <ellipse cx="${dx+21}" cy="172" rx="12" ry="36" fill="${gc('Legs')}" opacity="0.88"/>` : '',
    ].join('');
  }

  // Back muscle zones
  function backZones(dx) {
    return [
      gc('Back') ? `<path d="M${dx-24},44 Q${dx},52 ${dx+24},44 L${dx+32},96 Q${dx},102 ${dx-32},96 Z" fill="${gc('Back')}" opacity="0.88"/>
                    <path d="M${dx-32},96 C${dx-46},90 ${dx-48},100 ${dx-44},106 L${dx-28},112 Z" fill="${gc('Back')}" opacity="0.88"/>
                    <path d="M${dx+32},96 C${dx+46},90 ${dx+48},100 ${dx+44},106 L${dx+28},112 Z" fill="${gc('Back')}" opacity="0.88"/>` : '',
      gc('Shoulders') ? `<ellipse cx="${dx-46}" cy="56" rx="12" ry="18" fill="${gc('Shoulders')}" opacity="0.88"/>
                         <ellipse cx="${dx+46}" cy="56" rx="12" ry="18" fill="${gc('Shoulders')}" opacity="0.88"/>` : '',
      gc('Arms') ? `<ellipse cx="${dx-47}" cy="80" rx="7" ry="22" fill="${gc('Arms')}" opacity="0.88"/>
                    <ellipse cx="${dx+47}" cy="80" rx="7" ry="22" fill="${gc('Arms')}" opacity="0.88"/>` : '',
      gc('Legs') ? `<ellipse cx="${dx-21}" cy="122" rx="14" ry="14" fill="${gc('Legs')}" opacity="0.88"/>
                    <ellipse cx="${dx+21}" cy="122" rx="14" ry="14" fill="${gc('Legs')}" opacity="0.88"/>
                    <ellipse cx="${dx-21}" cy="178" rx="12" ry="38" fill="${gc('Legs')}" opacity="0.88"/>
                    <ellipse cx="${dx+21}" cy="178" rx="12" ry="38" fill="${gc('Legs')}" opacity="0.88"/>` : '',
    ].join('');
  }

  const LDX = 78, RDX = 222;

  return `<svg class="rbk-body-svg" viewBox="0 0 300 310" xmlns="http://www.w3.org/2000/svg">
    <text x="${LDX}"  y="10" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" font-weight="700" fill="#6c757d" letter-spacing="1.5">FRONT</text>
    <text x="${RDX}" y="10" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" font-weight="700" fill="#6c757d" letter-spacing="1.5">BACK</text>
    <g transform="translate(0,14)">
      ${silhouette(LDX)}
      ${frontZones(LDX)}
      ${silhouette(RDX)}
      ${backZones(RDX)}
    </g>
  </svg>`;
}

function openRankBreakdown() {
  const p = db.profile;
  if (!p?.weight) return;

  const prs = db.prs || {};
  if (!Object.keys(prs).length) { showToast('Log exercises to see breakdown'); return; }

  // Overall rank
  const overall = calcOverallRank();
  const overallStep = overall ? tierDivToStep(overall.tier, overall.div) : 0;
  const overallLabel = overall ? `${overall.tier.label} ${ROMAN[overall.div-1]}` : '—';
  const overallColor = overall ? TIER_COLORS[overall.tier.id] : '#6c757d';

  // Per muscle group averages
  const rawGroups = {};
  Object.entries(prs).forEach(([name, pr]) => {
    const group = EX_MUSCLE[name] || 'Other';
    if (!rawGroups[group]) rawGroups[group] = [];
    rawGroups[group].push(calcExScore(pr, p, name));
  });

  const groups = {};
  Object.entries(rawGroups).forEach(([g, scores]) => {
    const avg = scores.reduce((s,v) => s+v, 0) / scores.length;
    groups[g] = scoreToTierDiv(avg);
  });

  // Muscle group rows
  const MUSCLE_ORDER = ['Chest','Back','Legs','Shoulders','Arms','Core'];
  const groupRows = MUSCLE_ORDER.filter(g => groups[g]).map(g => {
    const { tier, div } = groups[g];
    const color = TIER_COLORS[tier.id];
    const step  = tierDivToStep(tier, div);
    const pct   = (step / 29 * 100).toFixed(1);
    return `<div class="rbk-group-row">
      <div class="rbk-group-top">
        <span class="rbk-group-name">${g}</span>
        <span class="rec-rank-badge t-${tier.id}">${tier.label} ${ROMAN[div-1]}</span>
      </div>
      <div class="rbk-group-bar">
        <div class="rbk-group-fill" style="width:${pct}%;background:${color}"></div>
        <div class="rbk-group-dot"  style="left:${pct}%;border-color:${color};box-shadow:0 0 6px ${color}88"></div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('rankBkBody').innerHTML = `
    <div class="rbk-section-lbl">Overall — <span style="color:${overallColor};font-weight:800">${overallLabel}</span></div>
    ${buildRankTimeline(overallStep)}
    <div class="rbk-divider"></div>
    <div class="rbk-section-lbl">By Body Part</div>
    ${groupRows}`;

  document.getElementById('rankBkOverlay').classList.add('open');
}

function closeRankBreakdown() {
  document.getElementById('rankBkOverlay').classList.remove('open');
}

function renderTodayCard() {
  const el     = document.getElementById('todayCard');
  const key    = todayKey();
  const exs    = db.schedule?.[key] || [];
  const tag    = db.dayTags?.[key];
  const p      = db.profile;
  const totalSets = exs.reduce((s, e) => s + e.sets, 0);

  const tagPart = tag ? ` · ${tag}` : '';
  const header = `<div class="session-hd">
    <span class="lbl">Today's Session${tagPart}</span>
    <span class="smeta">${exs.length} exercise${exs.length !== 1 ? 's' : ''} · ${totalSets} sets</span>
  </div>`;

  if (!exs.length) {
    el.innerHTML = header + `<div class="card"><div class="card-empty">No session planned. Go to <strong>Week</strong> to set one up.</div></div>`;
    return;
  }

  const rows = exs.map(ex => {
    let badgeHtml = '';
    if (p?.weight && db.prs?.[ex.name]) {
      const { tier, div } = scoreToTierDiv(calcExScore(db.prs[ex.name], p, ex.name));
      badgeHtml = `<span class="bdg t-${tier.id}">${TIER_SHORT[tier.id]} · ${ROMAN[div-1]}</span>`;
    }
    return `<div class="ex-row divr">
      <div class="ex-left">
        <div class="ex-name">${ex.name}</div>
        ${badgeHtml}
      </div>
      <div class="ex-nums">
        <span class="ex-w">${fmtWeight(ex.weight, ex.name)} × ${ex.reps}</span>
        <span class="ex-s">${ex.sets}×</span>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = header + `<div class="card">${rows}<button class="add-row"><span class="add-ic">+</span>Add exercise</button></div>`;
  el.querySelector('.add-row').addEventListener('click', () => openExModal(key, null));
}

function renderQuickLog() {
  const el = document.getElementById('quickLogCard');
  if (!el) return;
  const key = todayKey();
  const exs = db.schedule?.[key] || [];
  if (!exs.length) { el.innerHTML = ''; return; }

  const ex = exs[0];
  const valDisp = BODYWEIGHT_EX.has(ex.name)
    ? (ex.weight === 0 ? 'BW' : `+${ex.weight}`)
    : ex.weight;

  el.innerHTML = `<div class="qlog">
    <div class="qlog-hd">
      <span class="lbl">Quick Log</span>
      <span class="qlog-ex">${ex.name}</span>
    </div>
    <div class="qf-row">
      <div class="qf"><span class="qfv">${valDisp}</span><span class="qfl">kg</span></div>
      <div class="qf"><span class="qfv">${ex.reps}</span><span class="qfl">reps</span></div>
      <div class="qf"><span class="qfv">${ex.sets}</span><span class="qfl">sets</span></div>
    </div>
    <button class="qlog-cta" id="qlogBtn">Log this set →</button>
  </div>`;

  document.getElementById('qlogBtn').addEventListener('click', () => {
    const name = ex.name, weight = ex.weight, sets = ex.sets, reps = ex.reps;
    const pr    = db.prs[name];
    const bw    = db.profile?.weight || 0;
    const isBW  = BODYWEIGHT_EX.has(name);
    const bwFrac = BW_FRACTION[name] ?? 1.0;
    const epCap = isBW ? 0 : 30;
    const baseNew = isBW ? bw * bwFrac + weight : weight;
    const baseOld = pr ? (isBW ? bw * bwFrac + pr.weight : pr.weight) : 0;
    const new1RM  = calcEpley(baseNew, reps, epCap);
    const old1RM  = pr ? calcEpley(baseOld, pr.reps, epCap) : 0;
    const isPR    = new1RM > old1RM;
    if (isPR) db.prs[name] = { weight, sets, reps, date: new Date().toISOString() };
    if (!db.history) db.history = [];
    db.history.push({ name, weight, sets, reps, date: new Date().toISOString() });
    persist();
    renderHome();
    renderRecords();
    if (isPR) {
      showToast('New PR recorded! 🏆');
      fireNotif('New Personal Record!', `${name} — ${fmtWeight(weight, name)} × ${reps} reps. Keep pushing!`);
    } else {
      showToast('Set logged!');
    }
  });
}

function renderLastPerfCard() {
  const el  = document.getElementById('lastPerfCard');
  const prs = Object.entries(db.prs||{})
    .sort((a,b) => (b[1].date||'').localeCompare(a[1].date||''))
    .slice(0, 5);

  let inner = '';
  if (!prs.length) {
    inner = `<div class="card-empty">No performances yet. Log your first session.</div>`;
  } else {
    inner = prs.map(([name, pr]) =>
      `<div class="list-row">
        <span class="lr-name">${name}</span>
        <div class="lr-right">
          <span class="lr-weight">${fmtWeight(pr.weight, name)}</span>
          <span class="lr-date">${fmtDate(pr.date)}</span>
        </div>
      </div>`
    ).join('');
  }

  el.innerHTML = `<div style="padding:14px 14px 4px"><span class="lbl">Last Performances</span></div>${inner}`;
}

/* ═══════════════════════════════════════════
   RENDER: WEEK
═══════════════════════════════════════════ */
let selectedWeekDay = null;

function renderWeek() {
  if (!selectedWeekDay) selectedWeekDay = todayKey();

  const strip   = document.getElementById('daysStrip');
  const content = document.getElementById('weekDayContent');
  const today   = todayKey();
  const now     = new Date();
  const LETTERS = ['M','T','W','T','F','S','S'];

  strip.innerHTML = '';

  DAY_KEYS.forEach((key, i) => {
    const exs     = db.schedule?.[key] || [];
    const isToday = key === today;
    const isSel   = key === selectedWeekDay;
    const hasEx   = exs.length > 0;

    // Date number for this day in the current week (Mon-start)
    const dayOfWeek = [1,2,3,4,5,6,0][i];
    const diff = dayOfWeek - now.getDay();
    const d = new Date(now);
    d.setDate(now.getDate() + diff);

    const dayEl = document.createElement('div');
    let cls = 'day';
    if (hasEx && !isToday) cls += ' wk';
    if (isToday) cls += ' td';
    if (isSel && !isToday) cls += ' sel';
    dayEl.className = cls;
    dayEl.innerHTML = `<span class="day-l">${LETTERS[i]}</span><span class="day-n">${d.getDate()}</span><span class="day-dot"></span>`;
    dayEl.addEventListener('click', () => { selectedWeekDay = key; renderWeekContent(); });
    strip.appendChild(dayEl);
  });

  renderWeekContent();
}

function renderWeekContent() {
  const content = document.getElementById('weekDayContent');
  const key     = selectedWeekDay || todayKey();
  const dayIdx  = DAY_KEYS.indexOf(key);
  const exs     = db.schedule?.[key] || [];
  const today   = todayKey();
  const tag     = db.dayTags?.[key];

  // Section header
  const now   = new Date();
  const dayOfWeek = [1,2,3,4,5,6,0][dayIdx];
  const diff  = dayOfWeek - now.getDay();
  const d     = new Date(now);
  d.setDate(now.getDate() + diff);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const todayStr = key === today ? ' — Today' : '';
  const dateLabel = `${DAY_SHORT[dayIdx][0]}${DAY_SHORT[dayIdx].slice(1).toLowerCase()}, ${MONTHS[d.getMonth()]} ${d.getDate()}${todayStr}`;

  // Day tag row
  const tagHtml = tag
    ? `<button class="day-tag-chip" id="wcTagBtn">${tag}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`
    : `<button class="day-tag-chip add" id="wcTagBtn">+ Focus</button>`;

  if (!exs.length) {
    content.innerHTML = `<div class="wsec" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${dateLabel} ${tagHtml}</div>
      <div class="card"><div class="card-empty">No exercises planned.</div></div>`;
    content.querySelector('#wcTagBtn').addEventListener('click', () => openTagModal(key, dayIdx));
    return;
  }

  const rows = exs.map(ex => {
    const vol  = ex.weight > 0 ? ex.weight * ex.sets : 0;
    const volStr = vol > 0 ? `<span class="wvol">${vol}</span> <span class="wvol-u">kg</span>` : `<span class="wvol">${ex.sets}×${ex.reps}</span>`;
    return `<div class="wrow divr" data-id="${ex.id}">
      <div>
        <div class="wex-n">${ex.name}</div>
        <div class="wex-d">${ex.sets} sets · ${fmtWeight(ex.weight, ex.name)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${volStr}
        <button class="tiny-btn edit-wex" data-day="${key}" data-id="${ex.id}">✏️</button>
        <button class="tiny-btn del-wex"  data-day="${key}" data-id="${ex.id}">🗑️</button>
      </div>
    </div>`;
  }).join('');

  content.innerHTML = `<div class="wsec" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">${dateLabel} ${tagHtml}</div>
    <div class="card">${rows}</div>`;

  content.querySelector('#wcTagBtn').addEventListener('click', () => openTagModal(key, dayIdx));

  content.querySelectorAll('.edit-wex').forEach(btn => {
    btn.addEventListener('click', () => openExModal(btn.dataset.day, btn.dataset.id));
  });
  content.querySelectorAll('.del-wex').forEach(btn => {
    btn.addEventListener('click', () => deleteEx(btn.dataset.day, btn.dataset.id));
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

function renderWeekIfVisible() {
  if (document.getElementById('sw').classList.contains('on')) renderWeekContent();
}

/* ═══════════════════════════════════════════
   RECORDS: PROGRESS CHART
═══════════════════════════════════════════ */
function buildChart(exName) {
  const history = (db.history || []).filter(h => h.name === exName);
  if (history.length < 2) return '';

  const isBW = BODYWEIGHT_EX.has(exName);
  const bwFrac = BW_FRACTION[exName] ?? 1.0;
  const points = history.map(h => {
    const base = isBW ? (db.profile?.weight||0)*bwFrac + h.weight : h.weight;
    return { date: h.date, v: calcEpley(base, h.reps, isBW ? 0 : 30) };
  });

  const W = 300, H = 80, PAD = 8;
  const vals = points.map(p => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;

  const xs = points.map((_, i) => PAD + (i / (points.length - 1)) * (W - PAD*2));
  const ys = points.map(p => H - PAD - ((p.v - min) / range) * (H - PAD*2));

  const linePath = xs.map((x, i) => `${i===0?'M':'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const areaPath = linePath + ` L${xs[xs.length-1].toFixed(1)},${H} L${xs[0].toFixed(1)},${H} Z`;

  const lastX = xs[xs.length-1].toFixed(1);
  const lastY = ys[ys.length-1].toFixed(1);

  return `<svg class="rec-chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="cg-${exName.replace(/\s/g,'')}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--acc)" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="var(--acc)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#cg-${exName.replace(/\s/g,'')})" />
    <path d="${linePath}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lastX}" cy="${lastY}" r="4" fill="var(--acc)"/>
  </svg>`;
}


/* ═══════════════════════════════════════════
   RENDER: RECORDS
═══════════════════════════════════════════ */
function renderRecords() {
  const list = document.getElementById('recList');
  const prs  = db.prs || {};
  const p    = db.profile;

  if (!Object.keys(prs).length) {
    list.innerHTML = `<div class="empty-state"><b>No records yet</b>Log exercises in the Week tab — PRs appear here automatically.</div>`;
    return;
  }

  // Sort by most recent
  const entries = Object.entries(prs).sort((a,b) => (b[1].date||'').localeCompare(a[1].date||''));

  const ctEl = document.getElementById('recCount');
  if (ctEl) ctEl.textContent = `${entries.length} PR${entries.length !== 1 ? 's' : ''}`;
  list.innerHTML = '';

  entries.forEach(([name, pr]) => {
    let badgeHtml = '';
    if (p?.weight) {
      const { tier, div } = scoreToTierDiv(calcExScore(pr, p, name));
      badgeHtml = `<span class="rec-rank-badge t-${tier.id}">${TIER_SHORT[tier.id]} · ${ROMAN[div-1]}</span>`;
    }

    // E1RM
    const bwFrac  = BW_FRACTION[name] ?? 1.0;
    const isBW    = BODYWEIGHT_EX.has(name);
    const base    = isBW ? (p?.weight||0)*bwFrac + pr.weight : pr.weight;
    const e1rm    = calcEpley(base, pr.reps, isBW ? 0 : 30);
    const e1rmStr = `~${Math.round(e1rm)} kg`;

    const bestStr = `${fmtWeight(pr.weight, name)} × ${pr.reps}`;

    const chartHtml = buildChart(name);
    const hasChart  = chartHtml.length > 0;

    const wrap = document.createElement('div');
    wrap.className = 'rec-swipe-wrap';
    wrap.innerHTML = `
      <div class="rec-delete-bg"><span>Delete</span></div>
      <div class="prc${hasChart ? ' prc--chartable' : ''}" style="margin-bottom:0;border-radius:14px;position:relative;will-change:transform">
        <div class="prc-r1">
          <span class="prc-name">${name}</span>
          ${badgeHtml}
        </div>
        <div class="prc-r2">
          <div>
            <div class="pnum">${bestStr}</div>
            <div class="pnum-l">Best Set</div>
          </div>
          <div class="psep">→</div>
          <div>
            <div class="pnum a">${e1rmStr}</div>
            <div class="pnum-l">E1RM est.</div>
          </div>
        </div>
        ${hasChart ? `<div class="rec-chart-wrap" style="display:none">${chartHtml}</div>` : ''}
      </div>`;

    // Wire swipe-to-delete on the inner .prc element
    const itemEl = wrap.querySelector('.prc');
    attachSwipeDeleteEl(wrap, itemEl, name);

    if (hasChart) {
      itemEl.style.cursor = 'pointer';
      const chartWrap = wrap.querySelector('.rec-chart-wrap');
      itemEl.addEventListener('click', () => {
        chartWrap.style.display = chartWrap.style.display === 'none' ? 'block' : 'none';
      });
    }

    list.appendChild(wrap);
  });
}

function attachSwipeDeleteEl(wrap, item, exName) {
  let startX = 0, curX = 0, dragging = false;
  const THRESHOLD = 80;

  item.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    curX   = 0;
    dragging = true;
    item.style.transition = 'none';
  }, { passive: true });

  item.addEventListener('touchmove', e => {
    if (!dragging) return;
    curX = e.touches[0].clientX - startX;
    if (curX > 0) curX = 0;
    item.style.transform = `translateX(${curX}px)`;
  }, { passive: true });

  item.addEventListener('touchend', () => {
    dragging = false;
    item.style.transition = 'transform 0.25s ease';
    if (curX < -THRESHOLD) {
      item.style.transform = `translateX(-100%)`;
      setTimeout(() => {
        delete db.prs[exName];
        persist();
        renderRecords();
        showToast(`${exName} record deleted`);
      }, 250);
    } else {
      item.style.transform = 'translateX(0)';
    }
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
  // no auto-focus — keyboard popping up uninvited is annoying
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
}

// Tap weight display → inline number input
document.getElementById('weightBig').addEventListener('click', () => {
  const inp = document.getElementById('weightDirect');
  const big = document.getElementById('weightBig');
  inp.value = exWeight;
  big.style.display = 'none';
  inp.style.display = 'block';
  inp.focus();
  inp.select();
});
document.getElementById('weightDirect').addEventListener('blur', () => {
  const inp = document.getElementById('weightDirect');
  const val = parseFloat(inp.value);
  if (!isNaN(val)) exWeight = Math.max(0, Math.min(500, val));
  inp.style.display = 'none';
  document.getElementById('weightBig').style.display = '';
  updateWeightDisplay();
});
document.getElementById('weightDirect').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('weightDirect').blur();
});

// Step buttons
document.querySelectorAll('.ws-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const d = parseFloat(btn.dataset.d);
    if (btn.classList.contains('ws-minus')) exWeight = Math.max(0, exWeight - d);
    else exWeight = Math.min(500, exWeight + d);
    updateWeightDisplay();
  });
});

document.getElementById('exSearch').addEventListener('input', e => {
  buildPicker(e.target.value);
  if (!e.target.value) {
    exSelName = '';
    document.getElementById('exInputBlock').style.display = 'none';
  }
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

  if (!db.history) db.history = [];
  db.history.push({ name, weight: exWeight, sets: exSets, reps: exReps, date: new Date().toISOString() });

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
  document.getElementById('inName').value   = db.profile?.name   || '';
  document.getElementById('inWeight').value = db.profile?.weight || '';
  document.getElementById('inHeight').value = db.profile?.height || '';
  document.getElementById('inAge').value    = db.profile?.age    || '';
  selectedGender = db.profile?.gender || 'm';
  document.getElementById('gBtnM').classList.toggle('active', selectedGender === 'm');
  document.getElementById('gBtnF').classList.toggle('active', selectedGender === 'f');
  updateNotifBtn();
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
  db.profile.name   = document.getElementById('inName').value.trim();
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

document.getElementById('rankBkOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('rankBkOverlay')) closeRankBreakdown();
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
  if (!btn) return;
  const on = Notification.permission === 'granted' && db.notif?.enabled;
  btn.classList.toggle('on', on);
  btn.textContent = on ? 'On' : 'Enable';
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
document.querySelectorAll('.nb').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.t;
    const current = document.querySelector('.scr.on');
    if (current && current.id === target) return;

    document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');

    const next = document.getElementById(target);
    if (current) {
      current.classList.add('scr-exit');
      current.addEventListener('animationend', () => {
        current.classList.remove('on', 'scr-exit');
        next.classList.add('on', 'scr-enter');
        next.addEventListener('animationend', () => next.classList.remove('scr-enter'), { once: true });
      }, { once: true });
    } else {
      next.classList.add('on');
    }

    if (target === 'sw') renderWeek();
    if (target === 'sp') renderRecords();
    if (target === 'st') updateTimerRing();
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
