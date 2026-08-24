/* ── DATA ── */
const STORE = 'gymlog_v4';
function loadDB() {
  try { return JSON.parse(localStorage.getItem(STORE)) || defDB(); }
  catch { return defDB(); }
}
function defDB() {
  return { profile: { name:'', weight:null, height:null, age:null, gender:'m' }, schedule:{}, prs:{}, history:[], dayTags:{}, notif:{enabled:false} };
}
function persist() {
  localStorage.setItem(STORE, JSON.stringify(db));
  debouncedFirestoreSave();
}

/* ── FIREBASE ─────────────────────────────────────────────────────────── */
firebase.initializeApp({
  apiKey: "AIzaSyBPIkYnGat-AH7f75-2gfUfzeazWRXv7vM",
  authDomain: "gymlog-e1f5d.firebaseapp.com",
  projectId: "gymlog-e1f5d",
  storageBucket: "gymlog-e1f5d.firebasestorage.app",
  messagingSenderId: "1037901841560",
  appId: "1:1037901841560:web:a297a44e9b6c19be50bced"
});
const _auth = firebase.auth();
const _db   = firebase.firestore();
let   _user = null;
let   _firestoreSaveTimer = null;

function _userDoc() {
  return _db.collection('users').doc(_user.uid).collection('gymlog').doc('data');
}

let _profileSyncTimer = null;
function debouncedFirestoreSave() {
  if (!_user) return;
  clearTimeout(_firestoreSaveTimer);
  _firestoreSaveTimer = setTimeout(saveToFirestore, 2000);
  // keep public profile in sync with a longer debounce
  clearTimeout(_profileSyncTimer);
  _profileSyncTimer = setTimeout(syncPublicProfile, 10000);
}

async function saveToFirestore() {
  if (!_user) return;
  try { await _userDoc().set(db); }
  catch (e) { console.warn('Firestore save failed', e); }
}

async function loadFromFirestore() {
  if (!_user) return;
  try {
    const snap = await _userDoc().get();
    if (snap.exists) {
      // Case: returning user or account switch — cloud is authoritative, fully replace local
      const cloud = snap.data();
      Object.keys(db).forEach(k => delete db[k]);
      Object.assign(db, defDB(), cloud);
      localStorage.setItem(STORE, JSON.stringify(db));
    } else {
      // Case: no cloud data for this account yet (first sign-in)
      const hasLocalData = db.history?.length > 0 || Object.keys(db.prs||{}).length > 0;
      if (hasLocalData) {
        // Case 1: had local guest data → upload it all to cloud
        await _userDoc().set(db);
      } else {
        // Case 3: truly fresh — just seed defaults to cloud
        await _userDoc().set(defDB());
      }
    }
  } catch (e) { console.warn('Firestore load failed', e); }
}

function showSplash() {
  let el = document.getElementById('authTransLoader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'authTransLoader';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;align-items:center;justify-content:center;transition:opacity .25s';
    el.innerHTML = `<div style="width:32px;height:32px;border:3px solid var(--bdr);border-top-color:var(--acc);border-radius:50%;animation:spin .7s linear infinite"></div>`;
    document.body.appendChild(el);
  }
  el.style.opacity = '1';
  el.style.pointerEvents = 'all';
}

function hideSplash() {
  const el = document.getElementById('authTransLoader');
  if (!el) return;
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    setTimeout(() => el.remove(), 260);
  }, 250);
}

async function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  showSplash();
  try {
    await _auth.signInWithPopup(provider);
  } catch (e) {
    hideSplash();
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      // popup blocked — fall back to redirect
      await _auth.signInWithRedirect(provider);
    } else if (e.code !== 'auth/popup-closed-by-user') {
      showToast('Sign in error: ' + e.code);
    }
  }
}

async function signOutFirebase() {
  showSplash();
  await _auth.signOut();
  // wipe local data so signing in with a different account starts fresh
  localStorage.removeItem(STORE);
  localStorage.removeItem(THEME_KEY);
  db = defDB();
  migrateDB();
  applyTheme('carbon');
  renderHomeBar();
  renderProfileTab();
  if (document.getElementById('profileOverlay')?.classList.contains('open')) openProfile();
  renderTodaySession();
  renderWeek();
  renderRankCard();
  renderPRs();
  renderBestPRs();
  renderFriendsTab();
  hideSplash();
  showToast('Signed out');
}

// handle redirect result after Google sign-in
_auth.getRedirectResult().then(result => {
  if (result?.user) console.log('redirect sign-in ok', result.user.email);
}).catch(e => {
  console.error('redirect error', e.code, e.message);
  if (e.code) showToast('Sign in error: ' + e.code);
});

let _requestsUnsub = null;
const _UID_KEY = 'gymlog_uid';
function _hideAuthLoader(){
  const el=document.getElementById('authLoader');
  if(!el)return;
  el.style.opacity='0';
  setTimeout(()=>el.remove(),260);
}

_auth.onAuthStateChanged(async user => {
  _user = user;

  // tear down any previous listener
  if (_requestsUnsub) { _requestsUnsub(); _requestsUnsub = null; }

  if (user) {
    localStorage.setItem(_UID_KEY, user.uid);
    await loadFromFirestore();
    migrateDB();
    _hideAuthLoader();
    if (db.profile?.theme) applyTheme(db.profile.theme, false);
    await ensureFriendCode();
    syncPublicProfile();
    processFriendRequests();

    // real-time listener — fires instantly whenever a new request arrives
    _requestsUnsub = _requestsCol(user.uid).onSnapshot(snap => {
      if (!snap.empty) processFriendRequests();
    });

    renderProfileTab();
    renderRankCard();
    renderPRs();
    renderBestPRs();
    renderTodaySession();
    renderFriendsTab();
    if (document.getElementById('profileOverlay')?.classList.contains('open')) openProfile();
    showToast('✓ Signed in as ' + (user.displayName || user.email).split(' ')[0]);
    hideSplash();
  } else {
    localStorage.removeItem(_UID_KEY);
    _hideAuthLoader();
    renderProfileTab();
    renderFriendsTab();
    if (document.getElementById('profileOverlay')?.classList.contains('open')) openProfile();
  }
});

/* ── FRIEND SYSTEM ── */

function _codesCol() { return _db.collection('codes'); }
function _friendsCol(uid) { return _db.collection('users').doc(uid).collection('gymlog').doc('data'); }
function _requestsCol(uid) { return _db.collection('friendRequests').doc(uid).collection('incoming'); }

function genFriendCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

async function ensureFriendCode() {
  if (!_user) return;
  if (db.friendCode) {
    // make sure it's registered in codes collection
    try {
      await _codesCol().doc(db.friendCode).set({
        uid: _user.uid,
        name: db.profile?.name || _user.displayName || 'Athlete'
      }, { merge: true });
    } catch(e) { console.warn('code reg failed', e); }
    return;
  }
  // generate a unique code
  let code, attempts = 0;
  do {
    code = genFriendCode();
    const snap = await _codesCol().doc(code).get().catch(() => null);
    if (!snap || !snap.exists) break;
    attempts++;
  } while (attempts < 5);
  db.friendCode = code;
  try {
    await _codesCol().doc(code).set({
      uid: _user.uid,
      name: db.profile?.name || _user.displayName || 'Athlete'
    });
  } catch(e) { console.warn('code write failed', e); }
  persist();
}

function openOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelector('.sheet')?.scrollTo?.(0, 0);
  el.classList.add('open');
}

async function openFriends() {
  openOverlay('friendsOverlay');
  renderFriendsSheet();
  if (_user) await processFriendRequests();
}

function closeFriends() {
  document.getElementById('friendsOverlay').classList.remove('open');
}

document.getElementById('friendsClose').addEventListener('click', closeFriends);
document.getElementById('friendsOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('friendsOverlay')) closeFriends();
});

function renderFriendsSheet() {
  const codeEl = document.getElementById('friendsMyCode');
  const addEl  = document.getElementById('friendsAddRow');

  if (!_user) {
    codeEl.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--bdr);border-radius:14px;padding:20px;text-align:center;color:var(--t3);font-size:13px">Sign in with Google to use the friend system</div>`;
    addEl.innerHTML = '';
    return;
  }

  const code = db.friendCode || '------';
  const displayCode = code.toUpperCase();

  // QR card
  codeEl.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--bdr);border-radius:18px;padding:20px;text-align:center">
      <div id="friendQrCanvas" style="display:inline-block;background:#fff;border-radius:12px;padding:12px;margin-bottom:14px"></div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:30px;font-weight:900;letter-spacing:6px;color:var(--acc);margin-bottom:14px">${displayCode}</div>
      <div style="display:flex;gap:8px">
        <button class="prf-btn tap-scale" onclick="copyFriendCode()" style="flex:1;justify-content:center;padding:10px;font-size:13px">Copy code</button>
        <button class="prf-btn tap-scale" onclick="shareFriendCode()" style="flex:1;justify-content:center;padding:10px;font-size:13px">Share</button>
      </div>
    </div>`;

  // generate QR
  const qrEl = document.getElementById('friendQrCanvas');
  if (window.QRCode && qrEl) {
    new QRCode(qrEl, { text: code.toUpperCase(), width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M });
  }

  // Add by code + scan
  addEl.innerHTML = `
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--t3);margin-bottom:8px">Add by code</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input id="friendCodeInput" type="text" maxlength="6" placeholder="A3F9C2" autocomplete="off" autocorrect="off" spellcheck="false"
          style="flex:1;background:var(--bg2);border:1.5px solid var(--bdr);border-radius:14px;padding:11px 14px;font-size:18px;font-weight:900;letter-spacing:4px;color:var(--text);font-family:'Barlow Condensed',sans-serif;outline:none;text-transform:uppercase">
        <button class="prf-btn tap-scale" onclick="submitAddFriend()" style="flex-shrink:0;padding:11px 18px;font-size:14px;font-weight:700;border-radius:14px;background:var(--acc);color:#fff;border:none">Add</button>
      </div>
      <button class="tap-scale" onclick="openQrScanner()"
        style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:var(--bg2);border:1.5px solid var(--bdr);border-radius:14px;padding:13px;font-size:14px;font-weight:700;font-family:inherit;color:var(--text);cursor:pointer">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="3" height="3"/><rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/>
        </svg>
        Scan QR Code
      </button>
    </div>`;
}

// ── QR live scanner ──
let _qrStream = null, _qrRaf = null;

function openQrScanner() {
  const overlay = document.getElementById('qrScanOverlay');
  const video = document.getElementById('qrVideo');
  overlay.style.display = 'flex';
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      _qrStream = stream;
      video.srcObject = stream;
      video.play();
      _scanFrame(video);
    })
    .catch(() => showToast('Camera access denied'));
}

function closeQrScanner() {
  cancelAnimationFrame(_qrRaf);
  if (_qrStream) { _qrStream.getTracks().forEach(t => t.stop()); _qrStream = null; }
  document.getElementById('qrScanOverlay').style.display = 'none';
}

function _scanFrame(video) {
  if (!_qrStream) return;
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
    if (result) {
      const raw = result.data.trim().toLowerCase();
      if (raw.length === 6) {
        closeQrScanner();
        const input = document.getElementById('friendCodeInput');
        if (input) { input.value = raw.toUpperCase(); submitAddFriend(); return; }
        openOverlay('friendsOverlay');
        renderFriendsSheet();
        setTimeout(() => { const inp = document.getElementById('friendCodeInput'); if(inp){inp.value=raw.toUpperCase();submitAddFriend();} }, 200);
        return;
      }
    }
  }
  _qrRaf = requestAnimationFrame(() => _scanFrame(video));
}

function copyFriendCode() {
  const code = (db.friendCode || '').toUpperCase();
  navigator.clipboard.writeText(code).then(() => showToast('Code copied!')).catch(() => showToast(code));
}

function shareFriendCode() {
  const code = (db.friendCode || '').toUpperCase();
  const name = db.profile?.name || _user?.displayName || 'Friend';
  if (navigator.share) {
    navigator.share({ title: 'GymLog', text: `Add me on GymLog! My code: ${code} (${name})` }).catch(() => {});
  } else {
    copyFriendCode();
  }
}

async function processFriendRequests() {
  if (!_user) return;
  try {
    const snaps = await _requestsCol(_user.uid).get();
    if (snaps.empty) return;
    let changed = false;
    for (const doc of snaps.docs) {
      const req = doc.data();
      const already = (db.friends || []).find(f => f.uid === req.uid);
      if (!already) {
        if (!db.friends) db.friends = [];
        db.friends.push({ uid: req.uid, name: req.name, code: req.code, avatar: req.avatar || null, since: new Date().toISOString().slice(0,10) });
        changed = true;
      }
      await doc.ref.delete();
    }
    if (changed) { persist(); renderFriendsSheet(); renderProfileTab(); renderFriendsTab(); }
  } catch(e) { console.warn('processFriendRequests error', e); }
}

async function submitAddFriend() {
  if (!_user) { showToast('Sign in first'); return; }
  const input = document.getElementById('friendCodeInput');
  const code = (input.value || '').trim().toLowerCase();
  if (code.length !== 6) { showToast('Enter a 6-character code'); return; }
  if (code === db.friendCode) { showToast("That's your own code!"); return; }
  const existing = (db.friends || []).find(f => f.code === code);
  if (existing) { showToast('Already friends!'); return; }

  input.disabled = true;
  try {
    const codeSnap = await _codesCol().doc(code).get();
    if (!codeSnap.exists) { showToast('Code not found'); input.disabled = false; return; }
    const { uid: theirUid, name: theirName } = codeSnap.data();
    if (theirUid === _user.uid) { showToast("That's your own code!"); input.disabled = false; return; }

    // fetch their avatar
    const theirDoc = await _friendsCol(theirUid).get().catch(() => null);
    const theirAvatar = theirDoc?.data()?.profile?.avatar || null;

    // add them to my friends locally
    if (!db.friends) db.friends = [];
    db.friends.push({ uid: theirUid, name: theirName, code, avatar: theirAvatar, since: new Date().toISOString().slice(0,10) });
    persist();

    // notify them via friendRequests collection (anyone authenticated can write)
    const myEntry = {
      uid: _user.uid,
      name: db.profile?.name || _user.displayName || 'Athlete',
      code: db.friendCode || '',
      avatar: db.profile?.avatar || null
    };
    await _requestsCol(theirUid).doc(_user.uid).set(myEntry);

    input.value = '';
    showToast(`Added ${theirName}!`);
    closeFriends();
    renderProfileTab();
    renderFriendsTab();
  } catch(e) {
    console.warn('addFriend error', e);
    showToast('Error adding friend');
  }
  input.disabled = false;
}

async function removeFriend(uid) {
  if (!db.friends) return;
  db.friends = db.friends.filter(x => x.uid !== uid);
  persist();
  renderFriendsSheet();
  renderProfileTab();
  renderFriendsTab();
  showToast('Friend removed');
}

function renderFriendsTab() {
  const el = document.getElementById('friendsTabList');
  if (!el) return;
  const friends = db.friends || [];
  const addBtn = `<button onclick="openFriends()" class="add-row tap-scale" style="border-top:1px solid var(--bdr);width:100%"><span class="add-ic">+</span>Add friend</button>`;

  if (!_user) {
    el.innerHTML = `<div class="card" style="overflow:hidden">
      <div style="text-align:center;padding:28px 16px;color:var(--t3);font-size:13px">Sign in to add friends</div>
      ${addBtn}
    </div>`;
    return;
  }
  if (friends.length === 0) {
    el.innerHTML = `<div class="card" style="overflow:hidden">
      <div style="text-align:center;padding:28px 16px;color:var(--t3);font-size:13px">No friends yet</div>
      ${addBtn}
    </div>`;
    return;
  }

  function buildCard(f) {
    const cached = _friendProfileCache[f.uid] || {};
    const heroBg = cached.heroBg || null;
    const avatar = cached.avatar || f.avatar || null;
    const initials = (f.name || '?')[0].toUpperCase();
    const avHtml = avatar
      ? `<img src="${avatar}" style="width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid var(--bdr)">`
      : `<div style="width:42px;height:42px;border-radius:50%;background:var(--acc2);display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:900;color:var(--acc);flex-shrink:0">${initials}</div>`;
    const safeName   = (f.name||'Friend').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const safeCode   = (f.code||'').replace(/'/g,"\\'");
    const safeAvatar = (avatar||'').replace(/"/g,'&quot;');
    const safeHeroBg = (heroBg||'').replace(/"/g,'&quot;');
    const bgImg = '';
    const overlay = '';
    const textColor = 'var(--text)';
    const subColor  = 'var(--t3)';
    const igIcon = f.instagram ? `<div style="display:flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:${subColor}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke="#E1306C"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".5" fill="#E1306C" stroke="none"/></svg>@${f.instagram}</div>` : '';
    const ttIcon = f.tiktok   ? `<div style="display:flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:${subColor}"><svg width="11" height="11" viewBox="0 0 24 24" fill="#EE1D52"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.19 8.19 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/></svg>@${f.tiktok}</div>` : '';
    const socials = (igIcon || ttIcon) ? `<div style="display:flex;gap:8px;margin-top:3px">${igIcon}${ttIcon}</div>` : '';
    return `<div data-friend-uid="${f.uid}" data-friend-name="${safeName}" data-friend-code="${safeCode}" data-friend-avatar="${safeAvatar}" data-friend-hero="${safeHeroBg}" class="lw-row tap-scale friend-card-row" style="cursor:pointer;border-top:1px solid var(--bdr);position:relative;overflow:hidden">
      ${bgImg}
      ${overlay}
      <div style="position:relative;z-index:2;display:flex;align-items:center;width:100%">
        ${avHtml}
        <div style="flex:1;min-width:0;margin-left:10px">
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:900;color:${textColor};line-height:1.1">${f.name||'Friend'}</div>
          ${socials}
        </div>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2" style="stroke:var(--t3);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`;
  }

  let _friendsQ = (document.getElementById('friendsSearch')?.value || '').toLowerCase();
  function renderList() {
    const filtered = _friendsQ ? friends.filter(f => (f.name||'').toLowerCase().includes(_friendsQ)) : friends;
    const rows = filtered.length ? filtered.map(buildCard).join('') : `<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No results</div>`;
    el.innerHTML = `<input class="ex-search-inp" id="friendsSearch" placeholder="Search friends…" autocomplete="off" autocorrect="off" spellcheck="false" style="margin-bottom:10px" value="">
      <div class="card" style="overflow:hidden">${rows}${addBtn}</div>`;
    const inp = document.getElementById('friendsSearch');
    inp.value = _friendsQ;
    inp.addEventListener('input', e => {
      _friendsQ = e.target.value.toLowerCase();
      const f2 = _friendsQ ? friends.filter(f => (f.name||'').toLowerCase().includes(_friendsQ)) : friends;
      const r2 = f2.length ? f2.map(buildCard).join('') : `<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No results</div>`;
      el.querySelector('.card').innerHTML = r2 + addBtn;
      wireCards();
    });
  }

  function wireCards() {
    el.querySelectorAll('.friend-card-row').forEach(row => {
      let pressTimer = null;
      let didLong = false;
      const start = () => {
        didLong = false;
        pressTimer = setTimeout(() => {
          didLong = true;
          const uid2 = row.dataset.friendUid;
          const n2 = row.dataset.friendName || 'this friend';
          if (confirm(`Remove ${n2}?`)) {
            removeFriend(uid2);
          }
        }, 500);
      };
      const cancel = () => clearTimeout(pressTimer);
      const tap = () => { if (!didLong) openVisitorProfile(row.dataset.friendUid, row.dataset.friendName, row.dataset.friendCode, row.dataset.friendAvatar, row.dataset.friendHero); };
      row.addEventListener('pointerdown', start);
      row.addEventListener('pointerup', cancel);
      row.addEventListener('pointercancel', cancel);
      row.addEventListener('pointerleave', cancel);
      row.addEventListener('click', tap);
    });
  }
  renderList();
  wireCards();

  // refresh friend data in background
  friends.forEach(f => {
    _profilesCol().doc(f.uid).get().then(snap => {
      if (!snap.exists) return;
      const d = snap.data();
      const entry = (db.friends || []).find(x => x.uid === f.uid);
      if (!entry) return;
      let changed = false;
      if (d.name && d.name !== entry.name) { entry.name = d.name; changed = true; }
      if (d.avatar !== undefined && d.avatar !== entry.avatar) { entry.avatar = d.avatar; changed = true; }
      if (d.instagram !== undefined && d.instagram !== entry.instagram) { entry.instagram = d.instagram; changed = true; }
      if (d.tiktok !== undefined && d.tiktok !== entry.tiktok) { entry.tiktok = d.tiktok; changed = true; }
      if (changed) { persist(); renderList(); wireCards(); }
    }).catch(() => {});
  });
}

function _profilesCol() { return _db.collection('profiles'); }

function syncPublicProfile() {
  if (!_user) return;
  const r = calcOverallRank();
  const p = db.profile;
  const entries = Object.entries(db.prs||{});
  // recent PRs sorted by date desc
  entries.sort((a,b)=>{const d=(b[1].day||'').localeCompare(a[1].day||'');return d!==0?d:(b[1].date||'').localeCompare(a[1].date||'');});
  const recentPRs = entries.slice(0,30).map(([name,pr])=>{
    const tier = (!pr._cardio && p?.weight) ? scoreToTierDiv(calcExScore(pr,p,name)).tier : null;
    return { name, weight:pr.weight||null, reps:pr.reps||null, day:pr.day||pr.date||null, cardio:!!pr._cardio, tierId:tier?.id||null };
  });
  _profilesCol().doc(_user.uid).set({
    name: p?.name || _user.displayName || 'Athlete',
    avatar: p?.avatar || null,
    rankTier: r?.tier?.id || null,
    rankDiv: r?.div || null,
    prsCount: entries.length,
    workoutDays: new Set((db.history||[]).map(h=>h.day||h.date).filter(Boolean)).size,
    friendsCount: (db.friends||[]).length,
    instagram: p?.instagram || null,
    tiktok: p?.tiktok || null,
    heroBg: p?.heroBg || null,
    recentPRs,
    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true }).catch(() => {});
}

let _svPrevTab = 'sf';
let _friendProfileCache = {}; // uid → { heroBg, avatar } — session only

async function refreshFriendProfiles() {
  if (!_user) return;
  const friends = db.friends || [];
  if (!friends.length) return;
  try {
    await Promise.all(friends.map(async f => {
      if (_friendProfileCache[f.uid]) return;
      const snap = await _profilesCol().doc(f.uid).get();
      if (snap.exists) {
        const d = snap.data();
        _friendProfileCache[f.uid] = { heroBg: d.heroBg || null, avatar: d.avatar || null };
        console.log('[friends] profile fetched for', f.name, '| heroBg:', !!d.heroBg, '| avatar:', !!d.avatar);
      } else {
        console.warn('[friends] no profile doc for', f.name, f.uid);
      }
    }));
    renderFriendsTab();
  } catch(e) { console.warn('[friends] refreshFriendProfiles error', e); }
}

// ── shared profile hero builder ─────────────────────────────────────────────
// Used by both own profile (renderProfileTab) and visitor profile (renderVisitor).
// Returns a complete HTML string ready to inject into a container.
function buildProfileHero(o) {
  const c = o.rankTier ? (TIER_COLORS[o.rankTier]||'#C0392B') : '#C0392B';
  // hero background priority: custom heroBg → blurred avatar → rank gradient
  const bgStyle = o.heroBg
    ? `background-image:url('${o.heroBg}');background-size:cover;background-position:center;filter:brightness(.75);transform:scale(1.05)`
    : o.avatar
      ? `background-image:url('${o.avatar}');background-size:cover;background-position:center;filter:blur(20px) brightness(.6);transform:scale(1.12)`
      : `background-image:radial-gradient(ellipse at 60% 40%,${c}55 0%,transparent 70%),linear-gradient(135deg,#140a0a 0%,#1a0e1a 100%);transform:scale(1.05)`;

  const initials = (o.name||'?')[0].toUpperCase();
  const avInner = o.avatar
    ? `<img src="${o.avatar}" style="width:100%;height:100%;object-fit:cover">`
    : `<span style="font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:900">${initials}</span>`;

  const rankIcon = o.rankTier
    ? `<img src="${RANK_ICONS[o.rankTier]}" class="prf3-av-rank" style="filter:drop-shadow(0 0 4px ${c}bb)">`
    : '';
  const rankBadge = o.rankTier ? (()=>{
    const t = RANK_TIERS.find(t=>t.id===o.rankTier);
    return `<div class="prf-rank-badge" style="background:color-mix(in srgb,${c} 25%,rgba(0,0,0,.4));color:#fff;border:1px solid color-mix(in srgb,${c} 50%,transparent);backdrop-filter:blur(6px);margin-top:6px">${t?.label||''} ${ROMAN[(o.rankDiv||1)-1]||''}</div>`;
  })() : '';

  // socials section (below stat strip)
  const _igSvgCard = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke="#E1306C"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="#E1306C" stroke="none"/></svg>`;
  const _ttSvgCard = `<svg width="14" height="14" viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.19 8.19 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z" fill="var(--text)"/></svg>`;
  const _socialChip = (href, icon, platform) => `<a href="${href}" target="_blank" rel="noopener" class="prf-btn tap-scale" style="text-decoration:none;flex:1;justify-content:center;gap:7px">${icon}${platform}</a>`;
  let socialsHtml = '';
  if (o.instagram || o.tiktok) {
    const chips = [
      o.instagram ? _socialChip(`https://instagram.com/${o.instagram}`, _igSvgCard, 'Insta')  : '',
      o.tiktok    ? _socialChip(`https://tiktok.com/@${o.tiktok}`,       _ttSvgCard, 'TikTok') : '',
    ].join('');
    socialsHtml = `<div class="card-hd" style="padding:0 20px 8px">Socials</div><div style="margin:0 16px;display:flex;gap:10px">${chips}</div>`;
  }

  // recent PRs list (5 shown, view all button if more)
  let bestPRsHtml = '';
  const allPRs = o.recentPRs || o.bestPRs || [];
  if (allPRs.length) {
    const show = allPRs.slice(0,5);
    const rows = show.map(pr => {
      const badge = pr.tierId ? `<img src="${RANK_ICONS[pr.tierId]}" style="width:20px;height:20px;flex-shrink:0;display:block;image-rendering:pixelated;filter:drop-shadow(0 0 3px ${TIER_COLORS[pr.tierId]}99)">` : '';
      const perArm = isDumbbell(pr.name);
      const val = pr.cardio ? '' : `<span class="ex-w">${fmtWeight(pr.weight??0,pr.name)} × ${pr.reps}</span>`;
      const dateStr = pr.day ? new Date(pr.day).toLocaleDateString('en',{month:'short',day:'numeric'}) : '';
      const sub = [dateStr, perArm?'per arm':''].filter(Boolean).join(' · ');
      return `<div class="ex-row divr">
        <div class="ex-left" style="display:flex;align-items:center;gap:10px">
          ${badge}
          <div>
            <div class="ex-name">${fmtExName(pr.name)}</div>
            ${sub?`<div style="color:var(--t3);font-size:11px;font-weight:600;margin-top:2px">${sub}</div>`:''}
          </div>
        </div>
        <div class="ex-nums">${val}</div>
      </div>`;
    }).join('');
    const totalPRs = o.prsCount ?? allPRs.length;
    _friendPRsCache = { prs: allPRs, name: o.name || 'Friend' };
    const viewAllBtn = totalPRs > 5
      ? `<button class="add-row tap-scale" style="width:100%;border-top:1px solid var(--bdr)" onclick="openFriendPRs()"><span class="add-ic" style="font-size:13px">→</span>View all ${totalPRs} PRs</button>`
      : '';
    bestPRsHtml = `<div class="card-hd" style="padding:0 20px 8px">Latest PRs</div><div class="card" style="margin:0 16px;overflow:hidden">${rows}${viewAllBtn}</div>`;
  }

  return `<div>
    <div class="prf3-hero">
      <div class="prf3-hero-bg" style="${bgStyle}"></div>
      <div class="prf3-hero-overlay"></div>
      ${o.actionButtons||''}
      <div class="prf3-hero-center">
        <div class="prf3-av-wrap">
          <div class="prf3-av" style="cursor:default">${avInner}</div>
          ${rankIcon}
        </div>
        <div class="prf3-name">${o.name||'Athlete'}</div>
        ${rankBadge}
      </div>
    </div>
    <div class="prf3-stat-strip">
      <div class="prf3-stat"><span class="prf3-stat-n">${o.prsCount??'—'}</span><span class="prf3-stat-l">PRs</span></div>
      <div class="prf3-stat-div"></div>
      <div class="prf3-stat"><span class="prf3-stat-n">${o.workouts??'—'}</span><span class="prf3-stat-l">Workouts</span></div>
      <div class="prf3-stat-div"></div>
      <div class="prf3-stat"><span class="prf3-stat-n">${o.friendsCount??'—'}</span><span class="prf3-stat-l">Friends</span></div>
    </div>
    ${o.footer||''}
    <div style="padding:14px 0 32px">${socialsHtml}${socialsHtml&&bestPRsHtml?'<div style="height:14px"></div>':''}${bestPRsHtml}</div>
  </div>`;
}
// ───────────────────────────────────────────────────────────────────────────

async function openVisitorProfile(uid, name, code, avatar, heroBg) {
  const body = document.getElementById('svBody');
  if (!body) return;
  body.style.padding = '';
  _svPrevTab = document.querySelector('.scr.on')?.id || 'sf';

  function renderVisitor(p) {
    const html = buildProfileHero({
      heroBg:      p?.heroBg  || null,
      avatar:      p?.avatar  || avatar || null,
      rankTier:    p?.rankTier || null,
      rankDiv:     p?.rankDiv  || null,
      name:        p?.name    || name || 'Friend',
      instagram:   p?.instagram || null,
      tiktok:      p?.tiktok   || null,
      prsCount:    p?.prsCount    ?? '—',
      workouts:    p?.workoutDays ?? '—',
      friendsCount:p?.friendsCount ?? '—',
      recentPRs:   p?.recentPRs || p?.bestPRs || [],
    });
    body.innerHTML = html;
  }

  // fetch first behind the splash, then animate in with full content
  showSplash();
  let profileData = { name, avatar, heroBg: heroBg || null };
  if (_user) {
    try {
      const snap = await _profilesCol().doc(uid).get();
      if (snap.exists) profileData = snap.data();
    } catch(e) {}
  }
  renderVisitor(profileData);

  const sv = document.getElementById('sv');
  const cur = document.querySelector('.scr.on');
  if (cur) cur.classList.remove('on');
  sv.classList.add('on');
  history.pushState({ sv: uid }, '');
  hideSplash();
}

let _friendPRsCache = null;
let _friendPRSort = 'recent';

function openFriendPRs() {
  if (!_friendPRsCache) return;
  _friendPRSort = 'recent';
  renderFriendPRs();
  // reset scroll
  const body = document.getElementById('svBody');
  if (body) body.scrollTop = 0;
  // slide in from right (same pattern as openVisitorProfile)
  const sv = document.getElementById('sv');
  sv.classList.add('scr-er');
  sv.addEventListener('animationend', () => sv.classList.remove('scr-er'), { once: true });
  history.pushState({ svPRs: true }, '');
}

function renderFriendPRs() {
  if (!_friendPRsCache) return;
  const { prs, name: friendName } = _friendPRsCache;
  const body = document.getElementById('svBody');
  if (!body) return;

  // sort options mirroring main PR tab
  const sortOpts = [{id:'recent',label:'Recent'},{id:'best',label:'Best'},{id:'name',label:'A – Z'}];
  const sortBar = sortOpts.map(o => {
    const active = o.id === _friendPRSort;
    return `<button onclick="_friendPRSort='${o.id}';renderFriendPRs()" style="flex-shrink:0;border:1.5px solid ${active?'var(--acc)':'var(--bdr)'};border-radius:20px;padding:5px 13px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;background:${active?'var(--acc2)':'var(--card)'};color:${active?'var(--acc)':'var(--t2)'};">${o.label}</button>`;
  }).join('');

  // build header (non-scrolling), then sections go directly into svBody
  body.style.padding = '0';
  body.innerHTML = `
    <div class="pr-hd"><h1>${friendName}</h1><span class="pr-ct">${prs.length} PRs</span></div>
    <div style="display:flex;align-items:center;gap:8px;padding:0 22px 10px">
      <span style="font-size:12px;font-weight:600;color:var(--t3);white-space:nowrap;flex-shrink:0">Filter by:</span>
      <div style="display:flex;gap:6px">${sortBar}</div>
    </div>
    <div id="friendPRList" style="padding:0 18px 20px"></div>`;

  const list = document.getElementById('friendPRList');

  function makeRow(pr) {
    const badge = pr.tierId ? `<img src="${RANK_ICONS[pr.tierId]}" style="width:20px;height:20px;flex-shrink:0;display:block;image-rendering:pixelated;filter:drop-shadow(0 0 3px ${TIER_COLORS[pr.tierId]}99)">` : '';
    const ago = timeAgo(pr.day);
    const perArm = isDumbbell(pr.name);
    const val = pr.cardio ? '' : `<span class="ex-w">${fmtWeight(pr.weight??0,pr.name)} × ${pr.reps}</span>`;
    const sub = [ago, perArm?'per arm':''].filter(Boolean).join(' · ');
    const row = document.createElement('div');
    row.className = 'ex-row divr';
    row.innerHTML = `
      <div class="ex-left" style="display:flex;align-items:center;gap:10px">
        ${badge}
        <div>
          <div class="ex-name">${fmtExName(pr.name)}</div>
          ${sub?`<div style="font-size:11px;color:var(--t3);margin-top:2px">${sub}</div>`:''}
        </div>
      </div>
      <div class="ex-nums">${val}</div>`;
    return row;
  }

  function appendSection(label, items) {
    if (!items.length) return;
    const hd = document.createElement('div');
    hd.className = 'card-hd';
    hd.style.cssText = 'padding:0 20px 6px;margin-top:20px;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--t3)';
    hd.textContent = label;
    list.appendChild(hd);
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '8px';
    items.forEach(pr => card.appendChild(makeRow(pr)));
    list.appendChild(card);
  }

  if (_friendPRSort === 'recent') {
    const sorted = [...prs].sort((a,b) => (b.day||'').localeCompare(a.day||''));
    const groups = new Map();
    sorted.forEach(pr => {
      const day = (pr.day||'').slice(0,10);
      const lbl = day ? parseLocalDate(day).toLocaleDateString('en',{weekday:'long',month:'long',day:'numeric',year:'numeric'}) : 'Unknown';
      if (!groups.has(lbl)) groups.set(lbl,[]);
      groups.get(lbl).push(pr);
    });
    groups.forEach((items, lbl) => appendSection(lbl, items));
  } else if (_friendPRSort === 'best') {
    const sorted = [...prs].sort((a,b) => {
      const ai = RANK_TIERS.findIndex(t=>t.id===a.tierId), bi = RANK_TIERS.findIndex(t=>t.id===b.tierId);
      return bi - ai;
    });
    const groups = new Map();
    RANK_TIERS.slice().reverse().forEach(t => groups.set(t.label,[]));
    sorted.forEach(pr => {
      const t = RANK_TIERS.find(t=>t.id===pr.tierId);
      groups.get(t?.label || RANK_TIERS[0].label).push(pr);
    });
    groups.forEach((items,lbl) => appendSection(lbl, items));
  } else {
    const sorted = [...prs].sort((a,b) => a.name.localeCompare(b.name));
    const groups = new Map();
    sorted.forEach(pr => {
      const lbl = (pr.name[0]||'#').toUpperCase();
      if (!groups.has(lbl)) groups.set(lbl,[]);
      groups.get(lbl).push(pr);
    });
    groups.forEach((items,lbl) => appendSection(lbl, items));
  }
}

function closeVisitorProfile() {
  const sv = document.getElementById('sv');
  const prev = document.getElementById(_svPrevTab);
  if (!sv?.classList.contains('on')) return;
  prev?.classList.add('on','scr-el');
  sv.classList.add('scr-xr');
  sv.addEventListener('animationend',()=>sv.classList.remove('on','scr-xr'),{once:true});
  prev?.addEventListener('animationend',()=>prev?.classList.remove('scr-el'),{once:true});
}


function tsToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts._ms) return new Date(ts._ms);
  return null;
}
function migrateDB(){
  let dirty=false;

  // ensure top-level fields exist
  if(!db.schedule){db.schedule={};dirty=true;}
  if(!db.prs){db.prs={};dirty=true;}
  if(!Array.isArray(db.history)){db.history=[];dirty=true;}
  if(!db.dayTags){db.dayTags={};dirty=true;}
  if(!db.notif){db.notif={enabled:false};dirty=true;}
  if(!db.profile){db.profile={name:'',weight:null,height:null,age:null,gender:'m'};dirty=true;}
  if(!Array.isArray(db.friends)){db.friends=[];dirty=true;}

  // migrate old mon/tue/wed schedule keys → YYYY-MM-DD (current week as best guess)
  const OLD_DAYS=['mon','tue','wed','thu','fri','sat','sun'];
  if(OLD_DAYS.some(k=>Array.isArray(db.schedule[k]))){
    const now=new Date(),dow=now.getDay();
    const mondayDiff=dow===0?-6:1-dow;
    const monday=new Date(now.getFullYear(),now.getMonth(),now.getDate()+mondayDiff);
    const dateKeys=Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(d.getDate()+i);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
    OLD_DAYS.forEach((k,i)=>{if(db.schedule[k]?.length){db.schedule[dateKeys[i]]=db.schedule[k];delete db.schedule[k];}});
    dirty=true;
  }

  // ensure schedule entries have id
  Object.keys(db.schedule).forEach(dateKey=>{
    (db.schedule[dateKey]||[]).forEach(ex=>{
      if(!ex.id){ex.id=Math.random().toString(36).slice(2)+Date.now().toString(36);dirty=true;}
    });
  });

  // backfill history entries: _entryId and day
  db.history.forEach(h=>{
    if(!h._entryId){h._entryId=Math.random().toString(36).slice(2)+Date.now().toString(36);dirty=true;}
    if(!h.day&&h.date){
      try{
        const d=new Date(h.date);
        if(!isNaN(d.getTime())){
          h.day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          dirty=true;
        }
      }catch(e){}
    }
    // default sets/reps/weight if missing
    if(h.sets==null){h.sets=1;dirty=true;}
    if(h.reps==null){h.reps=0;dirty=true;}
    if(h.weight==null){h.weight=0;dirty=true;}
  });

  // remove orphaned schedule entries (no matching history _entryId) — runs after backfill
  const _histIds=new Set(db.history.map(h=>h._entryId).filter(Boolean));
  Object.keys(db.schedule).forEach(dateKey=>{
    const before=(db.schedule[dateKey]||[]).length;
    db.schedule[dateKey]=(db.schedule[dateKey]||[]).filter(ex=>ex.id&&_histIds.has(ex.id));
    if(db.schedule[dateKey].length!==before) dirty=true;
    if(!db.schedule[dateKey].length) delete db.schedule[dateKey];
  });

  // backfill pr.day from history for any PR missing it
  Object.keys(db.prs).forEach(name=>{
    const pr=db.prs[name];
    if(pr&&!pr.day&&pr.weight!=null){
      const match=db.history.find(h=>h.name===name&&h.weight===pr.weight&&h.reps===pr.reps&&h.sets===pr.sets);
      if(match?.day){pr.day=match.day;dirty=true;}
      else if(match?.date){
        try{const d=new Date(match.date);if(!isNaN(d)){pr.day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;dirty=true;}}catch(e){}
      }
    }
  });

  if(dirty) persist();
}

let db = loadDB();
migrateDB();

/* ── DATE HELPERS ── */
function localDateStr(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function todayDateStr(){return localDateStr(new Date());}
function getWeekDates(offset){
  const now=new Date(),dow=now.getDay();
  const mondayDiff=dow===0?-6:1-dow;
  const monday=new Date(now.getFullYear(),now.getMonth(),now.getDate()+mondayDiff+offset*7);
  return Array.from({length:7},(_,i)=>localDateStr(new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+i)));
}
function parseLocalDate(dateStr){const[y,m,d]=dateStr.split('-').map(Number);return new Date(y,m-1,d);}
function lastWeekDateOf(dateStr){const d=parseLocalDate(dateStr);d.setDate(d.getDate()-7);return localDateStr(d);}

function usualExsForDate(dateStr){
  const seen = new Map();
  let count = 0, iters = 0;
  const d = parseLocalDate(dateStr);
  while(count < 3 && iters < 26){
    d.setDate(d.getDate()-7);
    iters++;
    const key = localDateStr(d);
    const exs = db.schedule?.[key];
    if(exs && exs.length){
      exs.forEach(ex=>{ if(!seen.has(ex.name)) seen.set(ex.name, ex); });
      count++;
    }
  }
  return [...seen.values()];
}


/* ── NAV ── */
const NAV_ORDER = ['sh','sw','sp','sf','spr'];

function renderProfileTab(){
  const name=db.profile?.name?.trim();
  updateNotifToggle();
  // hero name
  const heroName=document.getElementById('scrProfileHeroName');
  if(heroName) heroName.textContent=name||'Athlete';
  const topName=document.getElementById('scrProfileTopName');
  if(topName) topName.textContent=name||'Athlete';
  // avatar
  const av=document.getElementById('scrProfileAv');
  const r=calcOverallRank();
  if(av){
    if(db.profile?.avatar){av.innerHTML=`<img src="${db.profile.avatar}">`;}
    else{av.textContent=name?name[0].toUpperCase():'G';}
  }
  // hero background: blurred avatar or accent gradient
  const heroBg=document.getElementById('scrProfileHeroBg');
  if(heroBg){
    if(db.profile?.heroBg){
      heroBg.style.backgroundImage=`url('${db.profile.heroBg}')`;
      heroBg.style.backgroundSize='cover';
      heroBg.style.backgroundPosition='center';
      heroBg.style.filter='brightness(.75)';
      heroBg.style.transform='scale(1.05)';
    } else if(db.profile?.avatar){
      heroBg.style.backgroundImage=`url('${db.profile.avatar}')`;
      heroBg.style.backgroundSize='cover';
      heroBg.style.backgroundPosition='center';
      heroBg.style.filter='blur(20px) brightness(.6)';
      heroBg.style.transform='scale(1.12)';
    } else {
      const c=r?TIER_COLORS[r.tier.id]:'#C0392B';
      heroBg.style.backgroundImage=`radial-gradient(ellipse at 60% 40%,${c}55 0%,transparent 70%),linear-gradient(135deg,#140a0a 0%,#1a0e1a 100%)`;
      heroBg.style.filter='';heroBg.style.transform='scale(1.05)';
    }
  }
  const rankBgEl=document.getElementById('scrProfileRankBg');
  const rankStatWrap=document.getElementById('scrStatRankWrap');
  const rankStatIcon=document.getElementById('scrStatRankIcon');
  if(rankBgEl){
    if(r){
      rankBgEl.src=RANK_ICONS[r.tier.id];
      rankBgEl.style.display='';
      rankBgEl.style.filter=`drop-shadow(0 0 4px ${TIER_COLORS[r.tier.id]}bb)`;
    }else{rankBgEl.style.display='none';}
  }
  if(rankStatWrap&&rankStatIcon){
    if(r){
      rankStatIcon.src=RANK_ICONS[r.tier.id];
      rankStatIcon.style.filter=`drop-shadow(0 0 4px ${TIER_COLORS[r.tier.id]}aa)`;
      rankStatWrap.style.display='';
    }else{rankStatWrap.style.display='none';}
  }
  const rankEl=document.getElementById('scrProfileRank');
  if(rankEl){
    if(r){
      const c=TIER_COLORS[r.tier.id];
      rankEl.className='prf-rank-badge';
      rankEl.style.cssText=`background:color-mix(in srgb,${c} 25%,rgba(0,0,0,.4));color:#fff;border:1px solid color-mix(in srgb,${c} 50%,transparent);backdrop-filter:blur(6px);margin-top:6px`;
      rankEl.textContent=`${r.tier.label} ${ROMAN[r.div-1]}`;
    } else {
      rankEl.className='';rankEl.style.cssText='color:rgba(255,255,255,.5);font-size:11px;margin-top:6px';
      rankEl.textContent='Set your profile to rank';
    }
  }
  // stats
  const prsCount=Object.keys(db.prs||{}).length;
  const workoutDays=new Set((db.history||[]).map(h=>h.day||h.date).filter(Boolean)).size;
  const friendsCount=(db.friends||[]).length;
  const wsEl=document.getElementById('scrStatWorkouts');
  const psEl=document.getElementById('scrStatPRs');
  const fsEl=document.getElementById('scrStatFriends');
  if(wsEl) wsEl.textContent=workoutDays;
  if(psEl) psEl.textContent=prsCount;
  if(fsEl) fsEl.textContent=friendsCount;
  const rankTileEl=document.getElementById('scrStatRank');
  if(rankTileEl){rankTileEl.textContent=r?`${r.tier.label} ${ROMAN[r.div-1]}`:'—';}
  // socials section
  const socialsEl=document.getElementById('scrSocials');
  if(socialsEl){
    const ig=db.profile?.instagram||null;
    const tt=db.profile?.tiktok||null;
    if(ig||tt){
      const _igSvg=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke="#E1306C"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="#E1306C" stroke="none"/></svg>`;
      const _ttSvg=`<svg width="14" height="14" viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.19 8.19 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z" fill="var(--text)"/></svg>`;
      const chip=(href,icon,platform)=>`<a href="${href}" target="_blank" rel="noopener" class="prf-btn tap-scale" style="text-decoration:none;flex:1;justify-content:center;gap:7px">${icon}${platform}</a>`;
      const chips=[ig?chip(`https://instagram.com/${ig}`,_igSvg,'Insta'):'',tt?chip(`https://tiktok.com/@${tt}`,_ttSvg,'TikTok'):''].join('');
      socialsEl.innerHTML=`<div class="card-hd" style="padding:14px 20px 8px">Socials</div><div style="margin:0 16px;display:flex;gap:10px">${chips}</div>`;
    } else {
      socialsEl.innerHTML='';
    }
  }
  // top 5 PRs
  const bp=document.getElementById('scrBestPRs');
  if(!bp) return;
  const p=db.profile;
  const entries=Object.entries(db.prs||{});
  if(!entries.length){bp.innerHTML='';return;}
  entries.sort((a,b)=>{const d=(b[1].day||'').localeCompare(a[1].day||'');return d!==0?d:(b[1].date||'').localeCompare(a[1].date||'');});
  const top5=entries.slice(0,5);
  bp.innerHTML=`<div class="card-hd" style="padding:14px 20px 8px">Latest PRs</div>`;
  const card=document.createElement('div');
  card.className='card';
  card.style.margin='0 16px';
  top5.forEach(([exName,pr])=>{
    let badgeHtml='';
    if(p?.weight&&!pr._cardio){
      const{tier,div}=scoreToTierDiv(calcExScore(pr,p,exName));
      badgeHtml=`<img src="${RANK_ICONS[tier.id]}" style="width:20px;height:20px;flex-shrink:0;display:block;image-rendering:pixelated;filter:drop-shadow(0 0 3px ${TIER_COLORS[tier.id]}99)">`;
    }
    let valHtml;
    if(pr._cardio){
      const km=(pr.distance/1000).toFixed(pr.distance%1000===0?0:1);
      const m=Math.floor(pr.duration/60),s=pr.duration%60;
      valHtml=`<span class="ex-w">${km} km · ${m}:${String(s).padStart(2,'0')} · ${(pr._spd*3.6).toFixed(1)} km/h</span>`;
    } else {
      valHtml=`<span class="ex-w">${fmtWeight(pr.weight,exName)} × ${pr.reps}</span>`;
    }
    const row=document.createElement('div');
    row.className='ex-row divr';
    const dateStr=(pr.day||pr.date)?new Date(pr.day||pr.date).toLocaleDateString('en',{month:'short',day:'numeric'}):'';
    row.innerHTML=`
      <div class="ex-left" style="display:flex;align-items:center;gap:10px">
        ${badgeHtml}
        <div>
          <div class="ex-name">${fmtExName(exName)}</div>
          ${dateStr?`<div style="color:var(--t3);font-size:11px;font-weight:600;margin-top:2px">${dateStr}</div>`:''}
        </div>
      </div>
      <div class="ex-nums">${valHtml}</div>`;
    card.appendChild(row);
  });
  if(entries.length>5){
    const more=document.createElement('button');
    more.className='add-row tap-scale';
    more.style.cssText='width:100%;border-top:1px solid var(--bdr)';
    more.innerHTML=`<span class="add-ic" style="font-size:13px">→</span>View all ${entries.length} PRs`;
    more.addEventListener('click',()=>goScr('sp'));
    card.appendChild(more);
  }
  bp.appendChild(card);
}

function goScr(t, dir){
  const cur = document.querySelector('.scr.on');
  if(cur && cur.id === t) return;

  document.querySelectorAll('.nb').forEach(n=>n.classList.toggle('on', n.dataset.t===t));
  if(t==='sh') renderTodaySession();
  if(t==='sw') renderWeek();
  if(t==='sp') renderPRs();
  if(t==='sf'){ renderFriendsTab(); if(_user) processFriendRequests(); }
  if(t==='spr') renderProfileTab();
  sessionStorage.setItem('gymlog_scr',t);
  // push a history entry so back button returns to previous tab, not closes app
  history.pushState({scr:t}, '', '');

  const next = document.getElementById(t);
  if(!cur){ next.classList.add('on'); return; }

  // reset scroll after layout so re-rendered content can't override it
  const nextSb = next.querySelector('.sb');
  const scrollTarget = nextSb || next;
  scrollTarget.scrollTop = 0;
  requestAnimationFrame(() => { scrollTarget.scrollTop = 0; });

  // pick animation classes based on direction
  let exitCls, enterCls;
  if(dir===1)       { exitCls='scr-xl'; enterCls='scr-er'; }
  else if(dir===-1) { exitCls='scr-xr'; enterCls='scr-el'; }
  else              { exitCls='scr-xf'; enterCls='scr-ef'; }

  // show next immediately, animate both simultaneously
  next.classList.add('on', enterCls);
  cur.classList.add(exitCls);
  next.addEventListener('animationend', ()=>next.classList.remove(enterCls), {once:true});
  cur.addEventListener('animationend', ()=>cur.classList.remove('on', exitCls), {once:true});
}

document.querySelectorAll('.nb').forEach(b=>{
  b.addEventListener('click', async ()=>{
    const from = NAV_ORDER.indexOf(document.querySelector('.scr.on')?.id);
    const to   = NAV_ORDER.indexOf(b.dataset.t);
    if(b.dataset.t==='sf' && _user) {
      showSplash();
      await refreshFriendProfiles();
      hideSplash();
      goScr(b.dataset.t, to > from ? 1 : to < from ? -1 : 0);
      return;
    }
    if(b.dataset.t==='spr') renderProfileTab();
    goScr(b.dataset.t, to > from ? 1 : to < from ? -1 : 0);
  });
});

/* ── APP SWIPE LEFT/RIGHT to switch tabs ── */
(function(){
  let sx=0, sy=0, locked=false;
  const app = document.getElementById('app');
  const strip = document.getElementById('daysStrip');
  app.addEventListener('touchstart', e=>{
    // ignore if touch starts on the week day strip (it has its own swipe)
    const onWeek = document.querySelector('.scr.on')?.id === 'sw';
    locked = strip.contains(e.target) || (onWeek && (!!e.target.closest('.ex-row') || !!e.target.closest('.lw-row')));
    sx=e.touches[0].clientX; sy=e.touches[0].clientY;
  },{passive:true});
  app.addEventListener('touchend', e=>{
    if(locked) return;
    if(document.querySelector('.overlay.open')) return;
    const dx=e.changedTouches[0].clientX-sx;
    const dy=e.changedTouches[0].clientY-sy;
    if(Math.abs(dx)<55 || Math.abs(dx)<Math.abs(dy)*1.4) return;
    const cur = NAV_ORDER.indexOf(document.querySelector('.scr.on')?.id);
    if(dx<0 && cur<NAV_ORDER.length-1) goScr(NAV_ORDER[cur+1],  1);
    if(dx>0 && cur>0)                  goScr(NAV_ORDER[cur-1], -1);
  },{passive:true});
})();

/* ── TOUCH PRESS ANIMATION (mobile :active fix) ── */
document.querySelectorAll('.tap-scale').forEach(el=>{
  el.addEventListener('touchstart',()=>el.classList.add('pressing'),{passive:true});
  el.addEventListener('touchend',()=>setTimeout(()=>el.classList.remove('pressing'),120),{passive:true});
  el.addEventListener('touchcancel',()=>el.classList.remove('pressing'),{passive:true});
});



/* ── BACK BUTTON / GESTURE ── */
// seed an initial state so the very first popstate has somewhere to go back from
history.replaceState({scr:'sh'}, '', '');
window.addEventListener('popstate', e=>{
  // close visitor screen if open
  if(e.state?.sv || document.getElementById('sv')?.classList.contains('on')){ closeVisitorProfile(); return; }
  // if any overlay is open, close it instead
  const openOverlay = document.querySelector('.overlay.open');
  if(openOverlay){ openOverlay.classList.remove('open'); history.pushState({scr: document.querySelector('.scr.on')?.id||'sh'}, '', ''); return; }
  const cur = document.querySelector('.scr.on')?.id;
  const idx = NAV_ORDER.indexOf(cur);
  if(idx > 0){
    // go back one tab without pushing a new history entry
    const prev = NAV_ORDER[idx-1];
    sessionStorage.setItem('gymlog_scr', prev);
    if(prev==='sh') renderTodaySession();
    if(prev==='sw') renderWeek();
    if(prev==='sp') renderPRs();
    if(prev==='sf') renderFriendsTab();
    if(prev==='spr') renderProfileTab();
    document.querySelectorAll('.nb').forEach(n=>n.classList.toggle('on', n.dataset.t===prev));
    const next = document.getElementById(prev);
    const active = document.getElementById(cur);
    next.classList.add('on','scr-el');
    active.classList.add('scr-xr');
    next.addEventListener('animationend',()=>next.classList.remove('scr-el'),{once:true});
    active.addEventListener('animationend',()=>active.classList.remove('on','scr-xr'),{once:true});
    // push a replacement so there's still a buffer entry for the next back press
    history.pushState({scr:prev}, '', '');
  }
  // if already on first tab, let the browser/OS handle it (closes app)
});

/* ── WEEK SWIPE (set up once) ── */
(function(){
  const strip=document.getElementById('daysStrip');
  let sx=0;
  strip.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;},{passive:true});
  strip.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-sx;
    if(Math.abs(dx)<55)return;
    const goingBack=dx>0; // swipe right = go to previous week
    const next=weekOffset+(goingBack?-1:1);
    if(next<-52||next>4)return;
    weekOffset=next;
    selWeekDate=null;
    renderWeek(goingBack?'prev':'next');
  },{passive:true});
})();

/* ── HOME BAR ── */
function renderHomeBar() {
  const now = new Date();
  const DAYS   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('dateLbl').textContent = `${DAYS[now.getDay()]} · ${MONTHS[now.getMonth()]} ${now.getDate()}`;

  const h = now.getHours();
  document.getElementById('greetSub').textContent = h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,';

  const name = db.profile?.name?.trim();
  document.getElementById('greetName').textContent = name ? name + '.' : 'Athlete.';
}


/* ── RANK SYSTEM ── */
const RANK_TIERS = [
  {id:'wood',     label:'Wood',     threshold:0   },
  {id:'iron',     label:'Iron',     threshold:1.2 },
  {id:'bronze',   label:'Bronze',   threshold:2.2 },
  {id:'silver',   label:'Silver',   threshold:3.2 },
  {id:'gold',     label:'Gold',     threshold:4.2 },
  {id:'platinum', label:'Platinum', threshold:5.4 },
  {id:'sapphire', label:'Sapphire', threshold:7.0 },
  {id:'diamond',  label:'Diamond',  threshold:9.0 },
  {id:'amethyst', label:'Amethyst', threshold:11.5},
  {id:'emerald',  label:'Emerald',  threshold:14.0},
  {id:'ruby',     label:'Ruby',     threshold:17.0},
  {id:'mythril',  label:'Mythril',  threshold:21.0},
];
const ROMAN = ['I','II','III'];
const RANK_ICONS={
  wood:     'Icons/rank_wood.png',
  iron:     'Icons/rank_iron.png',
  bronze:   'Icons/rank_bronze.png',
  silver:   'Icons/rank_silver.png',
  gold:     'Icons/rank_gold.png',
  platinum: 'Icons/rank_platinum.png',
  sapphire: 'Icons/rank_sapphire.png',
  diamond:  'Icons/rank_diamond.png',
  amethyst: 'Icons/rank_amethyst.png',
  emerald:  'Icons/rank_emerald.png',
  ruby:     'Icons/rank_ruby.png',
  mythril:  'Icons/rank_mythril.png',
};
function rankIconSvg(id,color,{size=60,glow=true,opacity=1,div=1}={}){
  const imgSrc=RANK_ICONS[id]||RANK_ICONS.wood;
  // snap to nearest integer multiple of 20 (source PNG is 20×21px) for pixel-perfect rendering
  const snap = Math.max(20, Math.round(size / 20) * 20);
  const f=glow?`filter:drop-shadow(0 0 ${Math.round(snap/5)}px ${color}99);`:'';
  const op=opacity<1?`opacity:${opacity};`:'';
  return `<img src="${imgSrc}" width="${snap}" height="${snap}" style="flex-shrink:0;display:block;width:${snap}px;height:${snap}px;${op}${f}image-rendering:pixelated">`;
}
const TIER_COLORS = {
  wood:'#8B6343',     iron:'#7A8A96',      bronze:'#C47A32',   silver:'#9AAEBB',
  gold:'#CFA020',     platinum:'#94A3B8',  sapphire:'#2563EB', diamond:'#67E8F9',
  amethyst:'#F472B6', emerald:'#10B981',   ruby:'#E11D48',     mythril:'#9333EA',
};
const EX_COEFF = {
  // Chest
  'Bench Press':1.00,'Incline Bench Press':0.88,'Decline Bench Press':1.02,
  'Dumbbell Bench Press':0.80,'Dumbbell Incline Press':0.70,'Incline Dumbbell Press':0.70,'Decline Dumbbell Press':0.90,
  'Dumbbell Fly':0.62,'Cable Fly':0.52,'Pec Deck':0.55,'Seated Chest Press':0.55,
  'Dips':1.50,'Push-up':1.36,
  // Back
  'Deadlift':1.75,'Pull-up':1.55,'Chin-up':1.55,
  'Barbell Row':0.92,'Dumbbell Row':0.80,'Chest Supported Row':0.72,
  'Lat Pulldown':0.82,'Seated Row':0.75,'T-Bar Row':0.90,'Cable Row':0.75,
  'Face Pull':0.48,'Straight Arm Pulldown':0.44,
  // Legs
  'Squat':1.50,'Front Squat':1.25,'Sled Leg Press':1.90,'Seated Leg Press':1.43,'Romanian Deadlift':1.20,
  'Dumbbell Romanian Deadlift':1.05,'Bulgarian Split Squat':1.10,
  'Leg Extension':0.72,'Leg Curl':0.68,
  'Hip Thrust':1.55,'Calf Raise':0.82,'Hack Squat':1.40,'Walking Lunges':0.88,
  // Shoulders
  'Overhead Press':0.65,'Dumbbell Shoulder Press':0.58,'Shrugs':1.00,
  'Lateral Raise':0.38,'Cable Lateral Raise':0.38,
  'Rear Delt Fly':0.38,'Rear Delt Cable Fly':0.38,'Reverse Pec Deck':0.50,
  'Front Raise':0.36,'Arnold Press':0.55,
  // Arms
  'Barbell Curl':0.42,'Dumbbell Biceps Curl':0.38,'Hammer Curl':0.38,'Preacher Curl':0.40,'Dumbbell Preacher Curl':0.38,
  'Leon Curl':0.38,'Tricep Pushdown':0.46,'Skull Crusher':0.50,
  'Overhead Tricep Extension':0.44,'Leon Pushdowns':0.35,'Rope Pushdown':0.46,
  // Core
  'Ab Wheel':0.32,'Hanging Leg Raise':0.30,'Crunch':0.22,'Russian Twist':0.26,
  'Cable Crunch':0.42,'Dragon Flag':0.35,'Leg Raise':0.30,
  'Plank':0.22,'Sit-up':0.20,'Toes to Bar':0.32,
};
const BODYWEIGHT_EX = new Set(['Pull-up','Chin-up','Dips','Push-up','Hanging Leg Raise','Leg Raise','Toes to Bar','Dragon Flag','Plank','Crunch','Sit-up','Muscle Up']);
const CARDIO_EX = new Set(['Running','Cycling','Rowing','Jump Rope','Swimming']);
const PER_ARM_EX = new Set([
  'Dumbbell Bench Press','Dumbbell Incline Press','Dumbbell Fly',
  'Dumbbell Biceps Curl','Hammer Curl','Dumbbell Preacher Curl','Leon Curl',
  'Dumbbell Shoulder Press','Rear Delt Fly','Front Raise','Arnold Press',
  'Dumbbell Row','Overhead Tricep Extension',
]);
function isDumbbell(name){return PER_ARM_EX.has(name);}
function fmtExName(name){return name.replace('Dumbbell ','DB ');}
const BW_FRACTION   = {'Push-up':0.65,'Plank':0.65,'Hanging Leg Raise':0.35,'Leg Raise':0.35,'Toes to Bar':0.35,'Dragon Flag':0.80,'Crunch':0.15,'Sit-up':0.20};

function calcLBM(weight,height,gender){
  if(!weight||!height) return Math.max((weight||70)*0.8,20);
  return gender==='f'?0.252*weight+0.473*height-48.3:0.407*weight+0.267*height-19.2;
}
function calcAgeMult(age){
  if(!age)return 1;if(age<20)return 0.97;if(age<35)return 1;if(age<40)return 1.02;
  if(age<45)return 1.05;if(age<50)return 1.09;if(age<55)return 1.13;
  if(age<60)return 1.18;if(age<65)return 1.24;return 1.31;
}
function calcEpley(weight,reps,cap){
  if(!reps||reps<=1)return weight;
  const r=cap>0?Math.min(reps,cap):reps;
  return weight*(1+r/30);
}
function calcExScore(pr,profile,name){
  const lbm=calcLBM(profile.weight,profile.height||170,profile.gender||'m');
  const coeff=EX_COEFF[name]??0.70;
  let base,cap;
  if(BODYWEIGHT_EX.has(name)){
    const f=BW_FRACTION[name]??1;
    base=(profile.weight||0)*f+(pr.weight||0);cap=0;
  }else{base=(pr.weight||0)*(isDumbbell(name)?2:1);cap=30;}
  const setsBonus=1+0.08*Math.log(Math.max(pr.sets||1,1));
  return(calcEpley(base,pr.reps,cap)/(Math.pow(Math.max(lbm,20),0.667)*coeff))*calcAgeMult(profile.age)*setsBonus;
}
function scoreToTierDiv(score){
  let idx=0;
  for(let i=0;i<RANK_TIERS.length;i++)if(score>=RANK_TIERS[i].threshold)idx=i;
  const tier=RANK_TIERS[idx],next=RANK_TIERS[idx+1];
  let frac=next?(score-tier.threshold)/(next.threshold-tier.threshold):Math.min((score-tier.threshold)/4.5,0.9999);
  const div=Math.min(Math.floor(frac*3)+1,3);
  const pct=Math.round(((frac*3)%1)*100);
  return{tierIdx:idx,tier,div,pct,nextTier:next||tier,nextDiv:div===3?1:div+1,isMaxDiv:idx===RANK_TIERS.length-1&&div===3};
}
function calcOverallRank(){
  const p=db.profile;
  if(!p?.weight)return null;
  const prs=Object.entries(db.prs||{}).filter(([n,pr])=>!pr._cardio);
  if(!prs.length)return{...scoreToTierDiv(0),count:0};
  const scores=prs.map(([n,pr])=>calcExScore(pr,p,n));
  const avg=scores.reduce((a,b)=>a+b,0)/scores.length;
  return{...scoreToTierDiv(avg),count:prs.length};
}

function recomputePR(name, onlyIfBetter=false){
  if(isCardio(name)){
    const entries=db.history.filter(h=>h.name===name&&h.distance>0&&h.duration>0);
    if(!entries.length){delete db.prs[name];return;}
    const best=entries.reduce((acc,h)=>{
      const spd=h.distance/h.duration;
      return spd>acc.spd?{spd,h}:acc;
    },{spd:-1,h:null});
    if(onlyIfBetter&&db.prs[name]&&best.spd<=db.prs[name]._spd) return;
    db.prs[name]={distance:best.h.distance,duration:best.h.duration,_spd:best.spd,date:best.h.date,day:best.h.day,_cardio:true};
    return;
  }
  const bw=db.profile?.weight||0;
  const isBW=BODYWEIGHT_EX.has(name);
  const isDB=isDumbbell(name);
  const bwFrac=BW_FRACTION[name]??1;
  const cap=isBW?0:30;
  const best=db.history.filter(h=>h.name===name&&(h.reps||0)>0).reduce((acc,h)=>{
    const base=isBW?bw*bwFrac+h.weight:(isDB?h.weight*2:h.weight);
    const rm=calcEpley(base,h.reps,cap);
    return rm>acc.rm?{rm,h}:acc;
  },{rm:-1,h:null});
  if(!best.h){delete db.prs[name];return;}
  if(onlyIfBetter&&db.prs[name]){
    const cur=db.prs[name];
    const curBase=isBW?bw*bwFrac+cur.weight:(isDB?cur.weight*2:cur.weight);
    const curRm=calcEpley(curBase,cur.reps,cap);
    if(best.rm<=curRm) return;
  }
  db.prs[name]={weight:best.h.weight,sets:best.h.sets,reps:best.h.reps,date:best.h.date,day:best.h.day};
}

function renderRankCard(){
  const el=document.getElementById('rankCard');
  if(!el)return;
  const r=calcOverallRank();
  if(!r){
    el.innerHTML=`<div class="card rank-no-profile">
      <p style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--t3);margin-bottom:6px">Strength Rank</p>
      <p style="font-size:13px;color:var(--t2)">Set your profile to unlock your rank.</p>
      <button class="rank-setup-btn" onclick="openProfile()">Set up profile →</button>
    </div>`;
    return;
  }
  const{tier,div,pct,nextTier,nextDiv,isMaxDiv,count}=r;
  const color=TIER_COLORS[tier.id];
  const curLabel=`${tier.label} ${ROMAN[div-1]}`;
  const nextLabel=isMaxDiv?'Mythril III · Max':div===3?`${nextTier.label} I`:`${tier.label} ${ROMAN[div]}`;
  const subtitle=count>0?`Based on ${count} exercise${count!==1?'s':''}`:'Log exercises to rank up';
  const step=tierDivToStep(tier,div);
  const pctile=rankStepToPercentile(step);
  const pctText=pctile>=99.5?'top 0.5% of gym-goers':pctile>=99?'top 1% of gym-goers':`better than ${Math.floor(pctile)}% of gym-goers`;
  el.innerHTML=`<div class="card" style="cursor:pointer" onclick="openRankBreakdown()">
    <div class="rank-card" style="--tc:${color}">
      <div class="rank-hex-wrap" style="width:72px;height:72px">
        ${rankIconSvg(tier.id,color,{size:72,div})}
      </div>
      <div class="rank-info">
        <div class="rank-sub">${subtitle}</div>
        <div class="rank-name">${curLabel}</div>
        <div class="rank-percentile">You are ${pctText}</div>
        <div class="rank-bar-wrap"><div class="rank-bar-fill" style="width:${pct}%"></div></div>
        <div class="rank-bar-lbls"><span>${curLabel}</span><span>${nextLabel}</span></div>
      </div>
    </div>
  </div>`;
}

/* ── RANK BREAKDOWN ── */
// 12 tiers × 3 divs = 36 steps (Iron I … Mythril III)
const STEP_PERCENTILE=[2,4,6,9,12,16,20,25,30,36,42,48,54,60,65,70,74,78,81,83,85,87,89,91,92.5,94,95.5,97,97.5,98,98.5,99,99.3,99.5,99.7,99.8];
const EX_MUSCLE={
  'Bench Press':'Chest','Incline Bench Press':'Chest','Decline Bench Press':'Chest',
  'Dumbbell Bench Press':'Chest','Dumbbell Incline Press':'Chest','Dumbbell Fly':'Chest','Cable Fly':'Chest','Pec Deck':'Chest','Dips':'Chest','Push-up':'Chest','Seated Chest Press':'Chest',
  'Deadlift':'Back','Pull-up':'Back','Chin-up':'Back','Barbell Row':'Back',
  'Lat Pulldown':'Back','Seated Row':'Back','T-Bar Row':'Back','Cable Row':'Back',
  'Face Pull':'Back','Straight Arm Pulldown':'Back',
  'Squat':'Legs','Front Squat':'Legs','Sled Leg Press':'Legs','Seated Leg Press':'Legs','Romanian Deadlift':'Legs',
  'Bulgarian Split Squat':'Legs','Leg Extension':'Legs','Leg Curl':'Legs',
  'Hip Thrust':'Legs','Calf Raise':'Legs','Hack Squat':'Legs','Walking Lunges':'Legs',
  'Overhead Press':'Shoulders','Dumbbell Shoulder Press':'Shoulders','Lateral Raise':'Shoulders',
  'Cable Lateral Raise':'Shoulders','Rear Delt Fly':'Shoulders','Rear Delt Cable Fly':'Shoulders','Reverse Pec Deck':'Shoulders','Front Raise':'Shoulders',
  'Arnold Press':'Shoulders','Shrugs':'Shoulders',
  'Barbell Curl':'Arms','Dumbbell Biceps Curl':'Arms','Hammer Curl':'Arms','Preacher Curl':'Arms','Dumbbell Preacher Curl':'Arms',
  'Leon Curl':'Arms','Tricep Pushdown':'Arms','Skull Crusher':'Arms',
  'Overhead Tricep Extension':'Arms','Leon Pushdowns':'Arms','Rope Pushdown':'Arms',
  'Ab Wheel':'Core','Hanging Leg Raise':'Core','Crunch':'Core','Sit-up':'Core','Russian Twist':'Core',
  'Cable Crunch':'Core','Dragon Flag':'Core','Leg Raise':'Core','Toes to Bar':'Core','Plank':'Core',
};
function tierDivToStep(tier,div){return RANK_TIERS.findIndex(t=>t.id===tier.id)*3+(div-1);}
function rankStepToPercentile(step){return STEP_PERCENTILE[Math.min(step,35)];}

function buildRankTimeline(markerStep){
  const activeTierIdx=Math.floor(markerStep/3);
  const activeDiv=(markerStep%3)+1;
  const badges=RANK_TIERS.map((t,ti)=>{
    const isPast=ti<activeTierIdx,isActive=ti===activeTierIdx,isFuture=ti>activeTierIdx;
    const color=TIER_COLORS[t.id];
    const fillOpacity=isActive?'1':isPast?'1':'0.12';
    const strokeOpacity=isFuture?'0.3':'1';
    const glow=isActive?`filter:drop-shadow(0 0 8px ${color}cc)`:isFuture?'opacity:0.25':'opacity:1';
    const pips=[1,2,3].map(d=>{
      const filled=isPast||(isActive&&d<=activeDiv),cur=isActive&&d===activeDiv;
      return `<span class="rlt-pip${filled?' filled':''}${cur?' cur':''}" style="${filled?`background:${color};border-color:${color}`:''}"></span>`;
    }).join('');
    const entryPct=100-STEP_PERCENTILE[Math.min(ti*3,STEP_PERCENTILE.length-1)];
    const pctLabel=entryPct<=0.5?'top 0.5%':entryPct<=1?'top 1%':`top ${Math.round(entryPct)}%`;
    const cellDiv=isPast?3:isActive?activeDiv:1;
    return `<div class="rlt-cell${isActive?' active':''}">
      ${rankIconSvg(t.id,color,{size:44,glow:isActive,opacity:isFuture?0.2:1,div:cellDiv})}
      <div class="rlt-cell-name" style="color:${isActive?color:color}">${t.label}</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:.3px;color:${isActive?color:'var(--t2)'};opacity:.85;margin-top:1px">${pctLabel}</div>
      <div class="rlt-pips">${pips}</div>
    </div>`;
  }).join('');
  return `<div class="rlt-grid">${badges}</div>`;
}

// Average gym-goer strength as a ratio of bodyweight (1RM equivalent, 5 big lifts)
const DEMOG_STANDARDS={
  'Bench Press':    {m:1.00,f:0.55},
  'Squat':          {m:1.25,f:0.80},
  'Deadlift':       {m:1.50,f:0.95},
  'Overhead Press': {m:0.65,f:0.38},
  'Barbell Row':    {m:0.90,f:0.55},
};
function calcDemogExpectedRank(profile){
  const bw=profile.weight;
  const g=profile.gender==='f'?'f':'m';
  const scores=Object.entries(DEMOG_STANDARDS).map(([name,ratios])=>{
    const w=Math.round(bw*ratios[g]);
    return calcExScore({weight:w,reps:5,sets:3},profile,name);
  });
  const avg=scores.reduce((s,v)=>s+v,0)/scores.length;
  return scoreToTierDiv(avg);
}
function openRankBreakdown(){
  const p=db.profile;
  if(!p?.weight)return;
  const prs=db.prs||{};
  if(!Object.keys(prs).length){showToast('Log exercises to see breakdown');return;}
  const overall=calcOverallRank();
  const overallStep=overall?tierDivToStep(overall.tier,overall.div):0;
  const overallLabel=overall?`${overall.tier.label} ${ROMAN[overall.div-1]}`:'—';
  const overallColor=overall?TIER_COLORS[overall.tier.id]:'#6c757d';

  // demographic comparison
  const exp=calcDemogExpectedRank(p);
  const expColor=TIER_COLORS[exp.tier.id];
  const expLabel=`${exp.tier.label} ${ROMAN[exp.div-1]}`;
  const expStep=tierDivToStep(exp.tier,exp.div);
  const diff=overallStep-expStep;
  let diffText,diffColor;
  if(diff>3){diffText=`${diff} ranks above average`;diffColor='var(--acc)';}
  else if(diff>0){diffText='slightly above average';diffColor='var(--acc)';}
  else if(diff===0){diffText='right at average';diffColor='var(--t2)';}
  else if(diff>-4){diffText='slightly below average';diffColor='var(--t2)';}
  else{diffText=`${Math.abs(diff)} ranks below average`;diffColor='#e06060';}
  const gLabel=p.gender==='f'?'women':'men';
  const ageLabel=p.age?`, age ${p.age}`:'';
  const demogHtml=`<div class="rbk-divider"></div>
    <div class="rbk-section-lbl">Demographic Comparison</div>
    <div class="rbk-demog-desc">Average for ${gLabel}${ageLabel} — based on Bench, Squat, Deadlift, OHP & Row</div>
    <div class="rbk-demog-row">
      <div class="rbk-demog-col">
        <div class="rbk-demog-lbl">You</div>
        <span class="rbk-demog-badge" style="background:color-mix(in srgb,${overallColor} 14%,transparent);color:${overallColor};border:1px solid color-mix(in srgb,${overallColor} 30%,transparent)">${overallLabel}</span>
      </div>
      <div class="rbk-demog-sep">vs</div>
      <div class="rbk-demog-col">
        <div class="rbk-demog-lbl">Typical</div>
        <span class="rbk-demog-badge" style="background:color-mix(in srgb,${expColor} 14%,transparent);color:${expColor};border:1px solid color-mix(in srgb,${expColor} 30%,transparent)">${expLabel}</span>
      </div>
    </div>
    <div class="rbk-demog-verdict" style="color:${diffColor}">${diffText}</div>`;

  document.getElementById('rankBkBody').innerHTML=`
    <div class="rbk-section-lbl">Overall — <span style="color:${overallColor};font-weight:800">${overallLabel}</span></div>
    ${buildRankTimeline(overallStep)}
    ${demogHtml}`;
  openOverlay('rankBkOverlay');
}
function closeRankBreakdown(){document.getElementById('rankBkOverlay').classList.remove('open');}
document.getElementById('rankBkOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeRankBreakdown();});

/* ── EXERCISES DATABASE ── */
const EX_DB = {
  'Chest':     ['Bench Press','Incline Bench Press','Decline Bench Press','Dumbbell Bench Press','Dumbbell Incline Press','Dumbbell Fly','Cable Fly','Pec Deck','Dips','Push-up','Seated Chest Press'],
  'Back':      ['Deadlift','Pull-up','Chin-up','Barbell Row','Lat Pulldown','Seated Row','T-Bar Row','Cable Row','Face Pull','Straight Arm Pulldown'],
  'Legs':      ['Squat','Front Squat','Sled Leg Press','Seated Leg Press','Romanian Deadlift','Bulgarian Split Squat','Leg Extension','Leg Curl','Hip Thrust','Calf Raise','Hack Squat','Walking Lunges'],
  'Shoulders': ['Overhead Press','Dumbbell Shoulder Press','Lateral Raise','Cable Lateral Raise','Rear Delt Fly','Rear Delt Cable Fly','Reverse Pec Deck','Front Raise','Arnold Press','Shrugs'],
  'Arms':      ['Barbell Curl','Dumbbell Biceps Curl','Hammer Curl','Preacher Curl','Dumbbell Preacher Curl','Leon Curl','Tricep Pushdown','Skull Crusher','Overhead Tricep Extension','Leon Pushdowns','Rope Pushdown'],
  'Core':      ['Plank','Ab Wheel','Hanging Leg Raise','Crunch','Sit-up','Russian Twist','Cable Crunch','Dragon Flag','Leg Raise','Toes to Bar'],
  'Calisthenics': ['Muscle Up','Pull-up','Chin-up','Dips','Push-up','Handstand Push-up','L-Sit','Front Lever','Back Lever'],
  'Cardio':    ['Running','Cycling','Rowing','Jump Rope','Swimming'],
};
const DAY_KEYS  = ['mon','tue','wed','thu','fri','sat','sun'];
const DAY_SHORT = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
const DAY_LONG  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const LETTERS   = ['M','T','W','T','F','S','S'];
const TIER_SHORT = {wood:'Wood',iron:'Iron',bronze:'Brz',silver:'Slv',gold:'Gold',platinum:'Plat',sapphire:'Sph',diamond:'Dia',amethyst:'Amy',emerald:'Emr',ruby:'Ruby',mythril:'Mythril'};

function todayKey(){return DAY_KEYS[[6,0,1,2,3,4,5][new Date().getDay()]];}
function uid(){return Math.random().toString(36).slice(2)+Date.now().toString(36);}
function fmtWeight(w,name){return BODYWEIGHT_EX.has(name)?(w===0?'BW':`+${w} kg`):`${w} kg`;}
function fmtCardio(ex){
  const dist=ex.distance||0, dur=ex.duration||0;
  const km=(dist/1000).toFixed(dist%1000===0?0:1);
  const min=Math.floor(dur/60), sec=dur%60;
  const timeStr=`${min}:${String(sec).padStart(2,'0')}`;
  if(dist>0&&dur>0){
    const kmh=((dist/1000)/(dur/3600)).toFixed(1);
    return `${km} km · ${timeStr} · ${kmh} km/h`;
  }
  if(dist>0) return `${km} km`;
  if(dur>0) return timeStr;
  return '—';
}

/* ── BEST PRs ── */
function renderBestPRs(){
  const el = document.getElementById('bestPRCard');
  if(!el) return;
  const p = db.profile;
  const entries = Object.entries(db.prs||{});
  if(!entries.length){ el.innerHTML=''; return; }

  // sort by score desc if profile set, else by date desc
  if(p?.weight){
    entries.sort((a,b)=>calcExScore(b[1],p,b[0])-calcExScore(a[1],p,a[0]));
  } else {
    entries.sort((a,b)=>(b[1].date||'').localeCompare(a[1].date||''));
  }
  const top3 = entries.slice(0,3);

  el.innerHTML = `<div class="card-hd">Best PRs</div>`;
  const card = document.createElement('div');
  card.className = 'card';
  top3.forEach(([name,pr])=>{
    let badgeHtml='';
    if(p?.weight&&!pr._cardio){
      const{tier,div}=scoreToTierDiv(calcExScore(pr,p,name));
      badgeHtml=`<img src="${RANK_ICONS[tier.id]}" style="width:20px;height:20px;flex-shrink:0;display:block;image-rendering:pixelated;filter:drop-shadow(0 0 3px ${TIER_COLORS[tier.id]}99)">`;
    }
    const row = document.createElement('div');
    row.className='ex-row divr';
    row.innerHTML=`
      <div class="ex-left">
        <div class="ex-name">${fmtExName(name)}</div>
        ${badgeHtml}
      </div>
      <div class="ex-nums">
        <span class="ex-w">${fmtWeight(pr.weight,name)} × ${pr.reps}</span>
        <span class="ex-s">${pr.sets}×</span>
      </div>`;
    card.appendChild(row);
  });
  el.appendChild(card);
}

/* ── TODAY SESSION ── */
function todayHistoryExs(){
  const today=todayDateStr();
  return (db.history||[]).filter(h=>{
    if(h.day) return h.day===today;
    if(!h.date) return false;
    return localDateStr(new Date(h.date))===today;
  });
}
function renderTodaySession(){
  const el=document.getElementById('todaySession');
  const today=todayDateStr();
  const DAYS_L=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dayName=DAYS_L[parseLocalDate(today).getDay()];

  // build logged map: name → {totalSets, best, bestScore, cardio, sets[]}
  const loggedMap={};
  todayHistoryExs().forEach(h=>{
    const cardio=isCardio(h.name);
    if(!loggedMap[h.name])loggedMap[h.name]={totalSets:0,best:null,bestScore:-1,cardio,sets:[]};
    if(cardio){
      const cur=loggedMap[h.name].best;
      if(!cur||(h.distance||0)>(cur.distance||0)||((h.distance||0)===(cur.distance||0)&&(h.duration||0)<(cur.duration||0)))
        loggedMap[h.name].best=h;
    } else {
      const n=h.sets||1;
      loggedMap[h.name].totalSets+=n;
      loggedMap[h.name].sets.push({weight:h.weight,reps:h.reps,sets:n});
      const isBW=BODYWEIGHT_EX.has(h.name),bw=db.profile?.weight||0;
      const s=calcEpley(isBW?(bw*(BW_FRACTION[h.name]??1)+h.weight):h.weight,h.reps,isBW?0:30);
      if(s>loggedMap[h.name].bestScore){loggedMap[h.name].best=h;loggedMap[h.name].bestScore=s;}
    }
  });

  // collapse identical weight+reps entries, build compact display string
  function fmtSets(name, g) {
    const merged = [];
    g.sets.forEach(s => {
      const prev = merged.find(m => m.weight === s.weight && m.reps === s.reps);
      if (prev) prev.sets += s.sets;
      else merged.push({...s});
    });
    if (merged.length === 1) {
      const m = merged[0];
      return `${fmtWeight(m.weight, name)} × ${m.reps} · ${m.sets} set${m.sets !== 1 ? 's' : ''}`;
    }
    return merged.map(m => `${fmtWeight(m.weight, name)} × ${m.reps} × ${m.sets}`).join(' · ');
  }

  // returns true if today's best for this exercise matches the stored PR
  const isTodayPR=(name,g)=>{
    const pr=db.prs?.[name];
    if(!pr||!g) return false;
    if(pr._cardio){
      const spd=g.best.distance>0&&g.best.duration>0?g.best.distance/g.best.duration:-1;
      return Math.abs(spd-(pr._spd||0))<0.0001;
    }
    return pr.weight===g.best.weight && pr.reps===g.best.reps;
  };

  const usualExs=usualExsForDate(today);

  // no usual exercises — show logged session if something exists, otherwise empty state
  const addExBtnHtml=`<button class="add-row" style="border-radius:0 0 12px 12px;border-top:1px solid var(--bdr)" onclick="openExModal('${today}',null)"><span class="add-ic">+</span>Add exercise</button>`;

  if(!usualExs.length){
    const loggedNames=Object.keys(loggedMap);
    if(!loggedNames.length){
      el.innerHTML=`<div class="session-hd" style="margin-bottom:10px"><span class="lbl">Today · ${dayName}</span></div>
      <div class="card"><div style="padding:14px 16px;font-size:13px;color:var(--t2)">No workout for today — rest up or start one below.</div>${addExBtnHtml}</div>`;
      return;
    }
    // something was logged freestyle
    const rows=loggedNames.map(name=>{
      const g=loggedMap[name];
      const prTag=isTodayPR(name,g)?`<span class="pr-tag">PR</span>`:'';
      const metaStr=g.cardio?fmtCardio(g.best):fmtSets(name,g);
      return `<div class="lw-row" style="cursor:pointer" onclick="openExModal('${today}','${name}')">
        <div class="lw-info">
          <div class="lw-name">${fmtExName(name)}${prTag}</div>
          <div class="lw-meta">${metaStr}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--acc);flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>
      </div>`;
    }).join('');
    el.innerHTML=`<div class="session-hd" style="margin-bottom:10px">
      <span class="lbl">Today · ${dayName}</span>
      <span class="smeta">${loggedNames.length} logged</span>
    </div><div class="card">${rows}${addExBtnHtml}</div>`;
    return;
  }

  const allNames=[...new Set([...usualExs.map(e=>e.name),...Object.keys(loggedMap)])];
  const doneCount=Object.keys(loggedMap).length;
  const subtitle=doneCount?`${doneCount} / ${allNames.length} done`:`${usualExs.length} exercise${usualExs.length!==1?'s':''}`;

  const rows=allNames.map(name=>{
    const g=loggedMap[name];
    const usual=usualExs.find(e=>e.name===name);
    if(g){
      // logged today — tap to edit
      const prTag2=isTodayPR(name,g)?`<span class="pr-tag">PR</span>`:'';
      const metaStr2=g.cardio?fmtCardio(g.best):fmtSets(name,g);
      return `<div class="lw-row" style="cursor:pointer" onclick="openExModal('${today}','${name}')">
        <div class="lw-info">
          <div class="lw-name" style="color:var(--t2)">${fmtExName(name)}${prTag2}</div>
          <div class="lw-meta">${metaStr2}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--acc);flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>
      </div>`;
    }else{
      // not yet done — tap to log it now
      const ref=usual||{weight:0,reps:0,sets:0,distance:0,duration:0};
      const refMeta=isCardio(name)?fmtCardio(ref):`${fmtWeight(ref.weight,name)} × ${ref.reps} · ${ref.sets} sets`;
      return `<div class="lw-row" style="cursor:pointer;opacity:.6" onclick="openExModal('${today}',null,'${name}')">
        <div class="lw-info">
          <div class="lw-name">${fmtExName(name)}</div>
          <div class="lw-meta">${refMeta}</div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--t3);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
    }
  }).join('');

  el.innerHTML=`<div class="session-hd" style="margin-bottom:10px">
    <span class="lbl">Today · ${dayName}</span>
    <span class="smeta">${subtitle}</span>
  </div>
  <div class="card">${rows}${addExBtnHtml}</div>`;
}

/* ── WEEK ── */
let weekOffset=0, selWeekDate=null, slideDir=null;
const MONTHS_S=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_LETTERS=['M','T','W','T','F','S','S'];
const DAY_SHORT_S=['MON','TUE','WED','THU','FRI','SAT','SUN'];

function renderWeek(dir){
  slideDir=dir??null;
  const today=todayDateStr();
  const dates=getWeekDates(weekOffset);
  if(!selWeekDate||!dates.includes(selWeekDate))
    selWeekDate=dates.includes(today)?today:dates[0];

  const strip=document.getElementById('daysStrip');
  strip.innerHTML='';


  dates.forEach((dateStr,i)=>{
    const d=parseLocalDate(dateStr);
    const isToday=dateStr===today;
    const isSel=dateStr===selWeekDate;
    const hasEx=(db.schedule?.[dateStr]||[]).length>0;
    let cls='day';
    if(hasEx&&!isToday)cls+=' wk';
    if(isToday)cls+=' td';
    if(isSel&&!isToday)cls+=' sel';
    const cell=document.createElement('div');
    cell.className=cls;
    cell.innerHTML=`<span class="day-l">${DAY_LETTERS[i]}</span><span class="day-n">${d.getDate()}</span><span class="day-dot"></span>`;
    cell.addEventListener('click',()=>{selWeekDate=dateStr;renderWeek();});
    strip.appendChild(cell);
  });

  renderWeekDay(slideDir);
  slideDir=null;
}

function renderWeekDay(dir){
  const el=document.getElementById('weekDayContent');
  if(dir){el.classList.remove('slide-prev','slide-next');void el.offsetWidth;el.classList.add(`slide-${dir}`);}
  const dateStr=selWeekDate||todayDateStr();
  const today=todayDateStr();
  const exs=db.schedule?.[dateStr]||[];
  const p=db.profile;

  const d=parseLocalDate(dateStr);
  const dayName=DAY_SHORT_S[((d.getDay()+6)%7)];
  const lbl=`${dayName[0]}${dayName.slice(1).toLowerCase()}, ${MONTHS_S[d.getMonth()]} ${d.getDate()}${dateStr===today?' — Today':''}`;

  el.innerHTML=`<div class="wsec">${lbl}</div><div class="card" id="weekCard"></div>`;
  const card=el.querySelector('#weekCard');

  function makeExRow(ex,editable){
    // wrapper holds the border and stays fixed; inner slides on swipe
    const wrap=document.createElement('div');
    wrap.className='lw-row';
    wrap.style.cssText=`${editable?'cursor:pointer;user-select:none;':'opacity:.7;'}`;
    const pr=db.prs?.[ex.name];
    let isPR=false;
    if(pr){
      if(pr._cardio) isPR=ex.distance>0&&ex.duration>0&&Math.abs(ex.distance/ex.duration-(pr._spd||0))<0.0001;
      else isPR=pr.weight===ex.weight&&pr.reps===ex.reps;
    }
    const prTagW=isPR?`<span class="pr-tag">PR</span>`:'';
    const weekMeta=isCardio(ex.name)?fmtCardio(ex):`${fmtWeight(ex.weight,ex.name)} × ${ex.reps} · ${ex.sets} sets${isDumbbell(ex.name)?' · per arm':''}`;
    wrap.innerHTML=`<div class="lw-info"><div class="lw-name">${fmtExName(ex.name)}${prTagW}</div><div class="lw-meta">${weekMeta}</div></div>`;
    if(editable){
      let holdTimer=null, holding=false;
      const startHold=()=>{
        holding=false;
        wrap.style.transition='background .5s';
        wrap.style.background='rgba(255,69,58,.15)';
        holdTimer=setTimeout(()=>{
          holding=true;
          const h=wrap.offsetHeight;
          wrap.style.overflow='hidden';
          wrap.style.height=h+'px';
          wrap.offsetHeight;
          wrap.style.transition='height .18s ease, opacity .18s ease';
          wrap.style.opacity='0';
          wrap.style.height='0';
          setTimeout(()=>{
            const _p=db.profile;
            const _prevRk=(!isCardio(ex.name)&&db.prs[ex.name]&&_p?.weight)?scoreToTierDiv(calcExScore(db.prs[ex.name],_p,ex.name)):null;
            db.schedule[dateStr]=db.schedule[dateStr].filter(e=>e.id!==ex.id);
            db.history=db.history.filter(h=>h._entryId!==ex.id);
            recomputePR(ex.name);
            const _newRk=(!isCardio(ex.name)&&db.prs[ex.name]&&_p?.weight)?scoreToTierDiv(calcExScore(db.prs[ex.name],_p,ex.name)):null;
            persist();renderWeek();renderTodaySession();renderRankCard();renderPRs();renderBestPRs();showToast('Exercise removed');
            if(_prevRk&&_newRk){const pi=RANK_TIERS.findIndex(t=>t.id===_prevRk.tier.id),ni=RANK_TIERS.findIndex(t=>t.id===_newRk.tier.id);if(ni<pi||(ni===pi&&_newRk.div<_prevRk.div))setTimeout(()=>showRankUp(_prevRk.tier.id,_prevRk.div,_newRk.tier.id,_newRk.div,true,ex.name),400);}
            else if(_prevRk&&!_newRk)setTimeout(()=>showRankUp(_prevRk.tier.id,_prevRk.div,'wood',1,true,ex.name),400);
          },200);
        },500);
      };
      const cancelHold=()=>{
        clearTimeout(holdTimer);
        wrap.style.background='';
        wrap.style.transition='';
      };
      wrap.addEventListener('mousedown',startHold);
      wrap.addEventListener('touchstart',startHold,{passive:true});
      wrap.addEventListener('mouseup',()=>{cancelHold();if(!holding)openExModal(dateStr,ex.id);});
      wrap.addEventListener('touchend',()=>{cancelHold();if(!holding)openExModal(dateStr,ex.id);});
      wrap.addEventListener('mouseleave',cancelHold);
      wrap.addEventListener('touchcancel',cancelHold);
    }
    return wrap;
  }

  // group entries by exercise name
  const exGroups=[];
  exs.forEach(ex=>{
    const g=exGroups.find(g=>g.name===ex.name);
    if(g) g.entries.push(ex);
    else exGroups.push({name:ex.name,entries:[ex]});
  });

  exGroups.forEach(g=>{
    if(g.entries.length===1){
      card.appendChild(makeExRow(g.entries[0],true));
    } else {
      // merged row — tap opens picker
      const wrap=document.createElement('div');
      wrap.className='lw-row';
      wrap.style.cssText='cursor:pointer;';
      const hasPR=g.entries.some(ex=>{const pr=db.prs?.[ex.name];return pr&&pr.weight===ex.weight&&pr.reps===ex.reps;});
      const prTag=hasPR?`<span class="pr-tag">PR</span>`:'';
      // build compact meta: dedupe weight×reps, accumulate sets
      const merged=[];
      g.entries.forEach(ex=>{
        const n=ex.sets||1;
        const prev=merged.find(m=>m.weight===ex.weight&&m.reps===ex.reps);
        if(prev) prev.sets+=n; else merged.push({weight:ex.weight,reps:ex.reps,sets:n,name:ex.name});
      });
      const _perArm=isDumbbell(g.name)?' · per arm':'';
      const metaStr=(merged.length===1
        ?`${fmtWeight(merged[0].weight,g.name)} × ${merged[0].reps} · ${merged[0].sets} set${merged[0].sets!==1?'s':''}`
        :merged.map(m=>`${fmtWeight(m.weight,g.name)} × ${m.reps} × ${m.sets}`).join(' · '))+_perArm;
      wrap.innerHTML=`<div class="lw-info"><div class="lw-name">${fmtExName(g.name)}${prTag}</div><div class="lw-meta">${metaStr}</div></div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2" style="stroke:var(--t3);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>`;
      wrap.addEventListener('click',()=>openExPicker(dateStr,g));
      card.appendChild(wrap);
    }
  });

  const addBtn=document.createElement('button');
  addBtn.className='add-row';
  addBtn.innerHTML='<span class="add-ic">+</span>Add exercise';
  addBtn.addEventListener('click',()=>openExModal(dateStr,null));
  card.appendChild(addBtn);

  // Usual exercises section
  const lwExs=usualExsForDate(dateStr);
  if(lwExs.length){
    const sec=document.createElement('div');
    sec.className='lw-sec';
    sec.innerHTML=`<div class="wsec" style="margin-bottom:8px">Usual</div>`;
    const lwCard=document.createElement('div');
    lwCard.className='card';
    lwExs.forEach(ex=>{
      const r=document.createElement('div');
      r.className='lw-row';
      r.innerHTML=`<div class="lw-info"><div class="lw-name">${fmtExName(ex.name)}</div><div class="lw-meta">${fmtWeight(ex.weight,ex.name)} × ${ex.reps} · ${ex.sets} sets${isDumbbell(ex.name)?' · per arm':''}</div></div>
        <button class="lw-add" title="Add to today">+</button>`;
      r.querySelector('.lw-add').addEventListener('click',()=>{
        if(!db.schedule[dateStr])db.schedule[dateStr]=[];
        const already=db.schedule[dateStr].some(e=>e.name===ex.name);
        if(already){showToast('Already in this day');return;}
        const schedId=uid();
        db.schedule[dateStr].push({...ex,id:schedId});
        const entryId=uid();
        const histEntry={name:ex.name,weight:ex.weight,sets:ex.sets,reps:ex.reps,date:new Date().toISOString(),day:dateStr,_entryId:entryId};
        if(!db.history)db.history=[];
        db.history.push(histEntry);
        persist();renderWeek();renderTodaySession();showToast(`${ex.name} added`);
      });
      lwCard.appendChild(r);
    });
    sec.appendChild(lwCard);
    el.appendChild(sec);
  }
}

/* ── PR PAGE ── */
const GROUP_ICONS={'Chest':'🫁','Back':'🔙','Legs':'🦵','Shoulders':'💆','Arms':'💪','Core':'🎯','Calisthenics':'🤸','Cardio':'🏃','Other':'⚡'};

function buildExToGroup(){
  const m={};
  Object.entries(EX_DB).forEach(([g,exs])=>exs.forEach(n=>m[n]=g));
  return m;
}

function timeAgo(dateStr){
  if(!dateStr)return'';
  const d=new Date(dateStr);
  if(isNaN(d.getTime()))return'';
  const now=new Date();
  const todayMid=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const dMid=new Date(d.getFullYear(),d.getMonth(),d.getDate());
  const diff=Math.round((todayMid-dMid)/(1000*60*60*24));
  if(diff<=0)return'today';
  if(diff===1)return'yesterday';
  if(diff<7)return`${diff}d ago`;
  if(diff<30)return`${Math.floor(diff/7)}w ago`;
  if(diff<365)return`${Math.floor(diff/30)}mo ago`;
  return`${Math.floor(diff/365)}y ago`;
}
function prTrend(name){
  const hist=(db.history||[]).filter(h=>h.name===name);
  if(hist.length<2)return'';
  hist.sort((a,b)=>(a.day||a.date||'').localeCompare(b.day||b.date||''));
  const bw=db.profile?.weight||0;
  const isBW=BODYWEIGHT_EX.has(name);
  const bwFrac=BW_FRACTION[name]??1;
  const e1rmOf=h=>{const base=isBW?(bw*bwFrac+(h.weight||0)):(isDumbbell(name)?(h.weight||0)*2:(h.weight||0));return calcEpley(base,h.reps,isBW?0:30);};
  const last=e1rmOf(hist[hist.length-1]);
  const prev=e1rmOf(hist[hist.length-2]);
  const delta=(last-prev)/Math.max(prev,1);
  if(delta>0.02)return'<span style="color:#4caf50;font-size:13px;font-weight:800">↑</span>';
  if(delta<-0.02)return'<span style="color:#e06060;font-size:13px;font-weight:800">↓</span>';
  return'<span style="color:var(--t3);font-size:13px;font-weight:800">→</span>';
}
let _prSort = 'recent';
const _prSortOpts = [
  { id:'recent', label:'Recent' },
  { id:'best',   label:'Best'   },
  { id:'name',   label:'A – Z'  },
];

function renderPRs(){
  const list=document.getElementById('prList');
  const prs=db.prs||{};
  const p=db.profile;
  const entries=Object.entries(prs);

  // sort bar
  const bar=document.getElementById('prSortBar');
  if(bar){
    bar.innerHTML=_prSortOpts.map(o=>{
      const active=o.id===_prSort;
      return `<button onclick="_prSort='${o.id}';renderPRs()" style="flex-shrink:0;border:1.5px solid ${active?'var(--acc)':'var(--bdr)'};border-radius:20px;padding:5px 13px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;background:${active?'var(--acc2)':'var(--card)'};color:${active?'var(--acc)':'var(--t2)'};">${o.label}</button>`;
    }).join('');
  }

  const ct=document.getElementById('prCount');
  if(ct) ct.textContent=entries.length?`${entries.length} PR${entries.length!==1?'s':''}` :'';

  if(!entries.length){
    list.innerHTML='<div style="padding:32px 22px;color:var(--t3);font-size:13px;line-height:1.6"><b style="color:var(--t2);display:block;margin-bottom:6px">No records yet</b>Log exercises in the Week tab — PRs appear here automatically.</div>';
    return;
  }

  const weightEntries=entries.filter(([n,pr])=>!pr._cardio&&!BODYWEIGHT_EX.has(n));
  const caliEntries=entries.filter(([n,pr])=>!pr._cardio&&BODYWEIGHT_EX.has(n));
  const cardioEntries=entries.filter(([,pr])=>pr._cardio);

  const sortByRecent=(a,b)=>{
    const dayDiff=(b[1].day||'').localeCompare(a[1].day||'');
    return dayDiff!==0?dayDiff:(b[1].date||'').localeCompare(a[1].date||'');
  };
  const sortByName=(a,b)=>a[0].localeCompare(b[0]);
  const sortStrength=(a,b)=>p?.weight?calcExScore(b[1],p,b[0])-calcExScore(a[1],p,a[0]):sortByName(a,b);

  list.innerHTML='';

  function makePRRow(name,pr){
    const ago=timeAgo(pr.day||pr.date);
    const trend=prTrend(name);
    let badgeHtml='',valueHtml='';
    if(pr._cardio){
      const km=(pr.distance/1000).toFixed(pr.distance%1000===0?0:1);
      const m=Math.floor(pr.duration/60),s=pr.duration%60;
      valueHtml=`<span class="ex-w">${km} km · ${m}:${String(s).padStart(2,'0')} · ${(pr._spd*3.6).toFixed(1)} km/h</span>`;
    } else {
      const isBW=BODYWEIGHT_EX.has(name);
      const bwFrac=BW_FRACTION[name]??1.0;
      const bw=p?.weight||0;
      const base=isBW?(bw*bwFrac+pr.weight):pr.weight;
      const e1rm=Math.round(calcEpley(base,pr.reps,isBW?0:30));
      const perArm=isDumbbell(name);
      valueHtml=`<span class="ex-w">${fmtWeight(pr.weight,name)} × ${pr.reps}</span>`;
      if(p?.weight){
        const{tier,div}=scoreToTierDiv(calcExScore(pr,p,name));
        badgeHtml=`<img src="${RANK_ICONS[tier.id]}" style="width:20px;height:20px;flex-shrink:0;display:block;image-rendering:pixelated;filter:drop-shadow(0 0 3px ${TIER_COLORS[tier.id]}99)">`;
      }
    }
    const row=document.createElement('div');
    row.className='ex-row divr';
    row.style.cssText='position:relative;overflow:hidden;cursor:pointer;';
    if(!pr._cardio) row.addEventListener('click',()=>openProg(name));
    row.innerHTML=`
      <div class="ex-left" style="display:flex;align-items:center;gap:10px">
        ${badgeHtml}
        <div>
          <div class="ex-name">${fmtExName(name)}</div>
          ${(ago||isDumbbell(name))?`<div style="font-size:11px;color:var(--t3);margin-top:2px">${ago}${isDumbbell(name)?`${ago?' · ':''}per arm`:''}</div>`:''}
        </div>
      </div>
      <div class="ex-nums" style="gap:4px">${trend}${valueHtml}</div>`;
    return row;
  }

  function appendSection(label,sectionEntries,subtle=false){
    if(!sectionEntries.length) return;
    const hd=document.createElement('div');
    hd.className='card-hd';
    hd.style.cssText=subtle
      ?'padding:0 20px 6px;margin-top:20px;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--t3)'
      :'padding:0 20px 8px;margin-top:24px';
    hd.textContent=label;
    list.appendChild(hd);
    const wrap=document.createElement('div');
    wrap.className='card';
    wrap.style.marginBottom='8px';
    sectionEntries.forEach(([name,pr])=>wrap.appendChild(makePRRow(name,pr)));
    list.appendChild(wrap);
  }

  if(_prSort==='recent'){
    const sorted=[...entries].sort(sortByRecent);
    const groups=new Map();
    sorted.forEach(e=>{
      const day=(e[1].day||e[1].date||'').slice(0,10);
      let lbl;
      if(day){const d=parseLocalDate(day);lbl=d.toLocaleDateString('en',{weekday:'long',month:'long',day:'numeric',year:'numeric'});}
      else lbl='Unknown';
      if(!groups.has(lbl)) groups.set(lbl,[]);
      groups.get(lbl).push(e);
    });
    groups.forEach((grp,lbl)=>appendSection(lbl,grp,true));
  } else if(_prSort==='best'){
    const sorted=[...entries].sort(sortStrength);
    const groups=new Map();
    RANK_TIERS.slice().reverse().forEach(t=>groups.set(t.label,[]));
    sorted.forEach(e=>{
      const [name,pr]=e;
      if(pr._cardio||!p?.weight){groups.get(RANK_TIERS[0].label).push(e);return;}
      const{tier}=scoreToTierDiv(calcExScore(pr,p,name));
      groups.get(tier.label).push(e);
    });
    groups.forEach((grp,lbl)=>appendSection(lbl,grp,true));
  } else {
    const sorted=[...entries].sort(sortByName);
    const groups=new Map();
    sorted.forEach(e=>{
      const lbl=(e[0][0]||'#').toUpperCase();
      if(!groups.has(lbl)) groups.set(lbl,[]);
      groups.get(lbl).push(e);
    });
    groups.forEach((grp,lbl)=>appendSection(lbl,grp,true));
  }
}

/* ── EXERCISE MODAL ── */
let exDay=null,exId=null,exName='',exWeight=60,exSets=3,exReps=8;
let cardioDist=0,cardioMin=0,cardioSec=0;

function openExPicker(dateStr, g) {
  // bottom sheet listing each entry for this exercise name
  const existing = document.getElementById('exPickerOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'exPickerOverlay';
  overlay.className = 'overlay';

  const sheet = document.createElement('div');
  sheet.className = 'sheet';

  const close = () => { overlay.classList.remove('open'); setTimeout(()=>overlay.remove(), 300); };
  overlay.addEventListener('click', e => { if (e.target===overlay) close(); });

  const rows = g.entries.map(ex => {
    const pr = db.prs?.[ex.name];
    const isPR = pr && pr.weight===ex.weight && pr.reps===ex.reps;
    const prTag = isPR ? `<span class="pr-tag">PR</span>` : '';
    const meta = isCardio(ex.name) ? fmtCardio(ex) : `${fmtWeight(ex.weight, ex.name)} × ${ex.reps} · ${ex.sets||1} set${(ex.sets||1)!==1?'s':''}`;
    const cardId = 'epick-' + ex.id;
    return `<div id="${cardId}" class="lw-row" style="cursor:pointer;user-select:none;transition:background .3s;">
      <div class="lw-info">
        <div class="lw-name">${meta}${prTag}</div>
        <div class="lw-meta">Hold to delete · tap to edit</div>
      </div>
    </div>`;
  }).join('');

  sheet.innerHTML = `
    <div class="sheet-pull"></div>
    <div class="sheet-hdr">
      <span class="sheet-title">${g.name}</span>
      <button class="sheet-x" onclick="document.getElementById('exPickerOverlay').classList.remove('open');setTimeout(()=>document.getElementById('exPickerOverlay')?.remove(),300)">×</button>
    </div>
    <div class="sheet-body" style="padding-bottom:16px">
      <div class="card" style="margin-bottom:14px">${rows}</div>
      <button onclick="document.getElementById('exPickerOverlay').classList.remove('open');setTimeout(()=>document.getElementById('exPickerOverlay')?.remove(),300);setTimeout(()=>openExModal('${dateStr}',null,'${g.name}'),320)" style="width:100%;background:var(--acc);color:#fff;border:none;border-radius:14px;padding:12px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;">+ Add another set</button>
    </div>`;

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  // wire tap-to-edit + hold-to-delete for each card
  g.entries.forEach(ex => {
    const card = document.getElementById('epick-' + ex.id);
    if (!card) return;
    let holdTimer = null;
    let holding = false;

    const startHold = () => {
      holding = false;
      card.style.transition = 'background .5s';
      card.style.background = 'rgba(255,69,58,.15)';
      holdTimer = setTimeout(() => {
        holding = true;
        card.style.transition = 'height .18s ease, opacity .18s ease, padding .18s ease, margin .18s ease';
        card.style.overflow = 'hidden';
        card.style.opacity = '0';
        card.style.height = card.offsetHeight + 'px';
        requestAnimationFrame(() => { card.style.height = '0'; card.style.padding = '0'; });
        setTimeout(() => {
          const _p=db.profile;
          const _prevRk=(!isCardio(g.name)&&db.prs[g.name]&&_p?.weight)?scoreToTierDiv(calcExScore(db.prs[g.name],_p,g.name)):null;
          db.schedule[dateStr] = (db.schedule[dateStr]||[]).filter(e => e.id !== ex.id);
          db.history = (db.history||[]).filter(h => h._entryId !== ex.id);
          recomputePR(g.name);
          const _newRk=(!isCardio(g.name)&&db.prs[g.name]&&_p?.weight)?scoreToTierDiv(calcExScore(db.prs[g.name],_p,g.name)):null;
          persist(); renderWeek(); renderTodaySession(); renderRankCard(); renderPRs(); renderBestPRs();
          if(_prevRk&&_newRk){const pi=RANK_TIERS.findIndex(t=>t.id===_prevRk.tier.id),ni=RANK_TIERS.findIndex(t=>t.id===_newRk.tier.id);if(ni<pi||(ni===pi&&_newRk.div<_prevRk.div))setTimeout(()=>showRankUp(_prevRk.tier.id,_prevRk.div,_newRk.tier.id,_newRk.div,true,g.name),400);}
          else if(_prevRk&&!_newRk)setTimeout(()=>showRankUp(_prevRk.tier.id,_prevRk.div,'wood',1,true,g.name),400);
          card.remove();
          // close when 1 or fewer entries remain (picker no longer needed)
          if ((db.schedule[dateStr]||[]).filter(e => e.name === g.name).length <= 1) {
            overlay.classList.remove('open');
            setTimeout(() => overlay.remove(), 300);
          }
          showToast('Removed');
        }, 200);
      }, 500);
    };
    const cancelHold = () => {
      clearTimeout(holdTimer);
      card.style.background = '';
      card.style.transition = '';
    };

    card.addEventListener('mousedown', startHold);
    card.addEventListener('touchstart', startHold, {passive:true});
    card.addEventListener('mouseup', () => { cancelHold(); if (!holding) { overlay.remove(); openExModal(dateStr, ex.id); } });
    card.addEventListener('touchend', () => { cancelHold(); if (!holding) { overlay.remove(); openExModal(dateStr, ex.id); } });
    card.addEventListener('mouseleave', cancelHold);
    card.addEventListener('touchcancel', cancelHold);
  });
}

function openExModal(dayKey,editId,prefillName){
  exDay=dayKey; exId=editId; exName='';
  if(editId){
    // try schedule id first, fall back to finding by name
    let ex=(db.schedule?.[dayKey]||[]).find(e=>e.id===editId);
    if(!ex) ex=(db.schedule?.[dayKey]||[]).find(e=>e.name===editId);
    if(ex){exId=ex.id;exName=ex.name;exWeight=ex.weight??60;exSets=ex.sets??3;exReps=ex.reps??8;
      if(isCardio(ex.name)){cardioDist=ex.distance||0;cardioMin=ex.duration?Math.floor(ex.duration/60):0;cardioSec=ex.duration?ex.duration%60:0;}
    }
    document.getElementById('exSheetTitle').textContent='Edit Exercise';
  }else if(prefillName){
    exName=prefillName;
    // prefill from usual exercises for that day
    const usual=usualExsForDate(dayKey).find(e=>e.name===prefillName);
    if(usual){exWeight=usual.weight;exSets=usual.sets;exReps=usual.reps;}
    else{exWeight=60;exSets=3;exReps=8;}
    document.getElementById('exSheetTitle').textContent='Log Exercise';
  }else{
    exWeight=60;exSets=3;exReps=8;
    document.getElementById('exSheetTitle').textContent='Add Exercise';
  }
  document.getElementById('exSearch').value=exName;
  document.getElementById('setsVal').textContent=exSets;
  document.getElementById('repsVal').textContent=exReps;
  document.getElementById('exInputBlock').classList.toggle('visible',!!exName);
  document.getElementById('exBackdrop').classList.toggle('visible',!!exName);
  if(exName){
    document.getElementById('exSelectedLbl').textContent=exName;
    if(isCardio(exName)){
      // restore from existing entry if editing
      const ex2=exId?(db.schedule?.[dayKey]||[]).find(e=>e.id===exId):null;
      cardioDist=ex2?.distance||0; cardioMin=ex2?.duration?Math.floor(ex2.duration/60):0; cardioSec=ex2?.duration?ex2.duration%60:0;
    }
    updateWeightLbl(); updateWeightDisp(); updateCardioFields();
  } else {
    document.getElementById('strengthFields').style.display='block';
    document.getElementById('cardioFields').style.display='none';
  }
  buildPicker('');
  openOverlay('exOverlay');
}

/* ── PROGRESSION CHART ── */
function openProg(name){
  const overlay=document.getElementById('progOverlay');
  document.getElementById('progName').textContent=name;
  buildProgChart(name);
  openOverlay('progOverlay');
}
function closeProg(){
  document.getElementById('progOverlay').classList.remove('open');
}
function buildYouVsOthers(name,p){
  if(!p?.weight) return '';
  const pr=db.prs[name];
  if(!pr) return '';
  const{tier,div}=scoreToTierDiv(calcExScore(pr,p,name));
  const color=TIER_COLORS[tier.id];
  const tierIdx=RANK_TIERS.findIndex(t=>t.id===tier.id);
  const _pctileVal=rankStepToPercentile(tierIdx*3+div-1);
  const pctLabel=_pctileVal>=99.5?'Top 0.5%':_pctileVal>=99?'Top 1%':`Top ${Math.ceil(100-_pctileVal)}%`;
  const isBW=BODYWEIGHT_EX.has(name);
  const bw=p?.weight||0;
  const bwFrac=BW_FRACTION[name]??1;
  const base=isBW?(bw*bwFrac+(pr.weight||0)):(pr.weight||0);
  const e1rm=Math.round(calcEpley(base,pr.reps,isBW?0:30));
  const e1rmLabel=isBW?`BW + ${Math.max(0,e1rm-Math.round(bw*bwFrac))} kg`:`${e1rm} kg`;
  // avg tier = Bronze (index 2)
  const AVG_IDX=2;
  // dot timeline — 10 tiers, no divisions
  const dots=RANK_TIERS.map((t,i)=>{
    const isCur=i===tierIdx;
    const isPast=i<tierIdx;
    const isAvg=i===AVG_IDX;
    const c=TIER_COLORS[t.id];
    const dotSize=isCur||isAvg?14:8;
    const opacity=isCur?1:isPast?1:0.2;
  
    // connector line before this dot (except first)
    const line=i>0?`<div style="flex:1;height:2px;background:${i<=tierIdx?TIER_COLORS[RANK_TIERS[i-1].id]:'var(--bdr)'};opacity:${i<=tierIdx?0.5:1};margin-bottom:${isCur||i===tierIdx+1?'3px':'6px'};align-self:center;margin-top:${isCur||i===tierIdx?'3px':'6px'}"></div>`:'';
    return `${line}<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;gap:3px">
      <div style="height:14px;display:flex;align-items:center;justify-content:center">
        ${isCur?`<span style="font-size:8px;color:${c};font-weight:800;letter-spacing:.5px">YOU</span>`:isAvg?`<span style="font-size:8px;color:var(--t3);font-weight:800;letter-spacing:.5px">AVG</span>`:''}
      </div>
      <div style="height:16px;display:flex;align-items:center;justify-content:center">
        <div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${isCur||isPast?c:'var(--bdr)'};opacity:${opacity};${isCur?`box-shadow:0 0 10px ${c}99`:''}"></div>
      </div>
      <img src="${RANK_ICONS[t.id]}" style="width:16px;height:16px;opacity:${isCur?1:isPast?1:0.25}">
    </div>`;
  }).join('');
  return `<div class="card" style="margin:0 0 16px;border-radius:14px;padding:16px 18px 20px">
    <div style="font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:var(--t2);font-weight:700;margin-bottom:14px">You vs Others</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:12px">
        ${rankIconSvg(tier.id,color,{size:44,glow:true,div})}
        <div>
          <div style="font-size:20px;font-weight:900;color:${color};font-family:'Barlow Condensed',sans-serif;letter-spacing:-0.5px">${tier.label} ${ROMAN[div-1]}</div>
          <div style="font-size:11px;color:var(--t2);font-weight:600;margin-top:1px">${pctLabel} of lifters</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--t3);font-weight:700">e1RM</div>
        <div style="font-size:22px;font-weight:900;font-family:'Barlow Condensed',sans-serif;color:var(--t1);letter-spacing:-0.5px">${e1rmLabel}</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;width:100%">${dots}</div>
  </div>`;
}

function buildProgChart(name){
  const container=document.getElementById('progChart');
  const isBW=BODYWEIGHT_EX.has(name);
  const p=db.profile;
  const bw=p?.weight||0;
  const bwFrac=BW_FRACTION[name]??1;
  const cap=isBW?0:30;

  // all entries for this exercise sorted by workout date (oldest first)
  const entries=(db.history||[])
    .filter(h=>h.name===name&&(h.reps||0)>0&&((h.weight||0)>0||isBW))
    .map(h=>({...h,_d:h.day||localDateStr(new Date(h.date))}))
    .sort((a,b)=>a._d.localeCompare(b._d));

  const meta=document.getElementById('progMeta');
  meta.textContent=entries.length?`${entries.length} session${entries.length!==1?'s':''}`:' ';

  if(!entries.length){
    container.innerHTML=buildYouVsOthers(name,p)+'<div style="padding:20px;text-align:center;color:var(--t2);font-size:13px">No sessions logged yet</div>';
    return;
  }

  const rows=entries.map(h=>{
    const base=isBW?bw*bwFrac+h.weight:h.weight;
    const e1rm=calcEpley(base,h.reps,cap);
    // use calcExScore so sets bonus is included in the rank badge
    const tier=p?.weight?scoreToTierDiv(calcExScore(h,p,name)).tier:null;
    const badgeHtml=tier?`<span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:6px;background:color-mix(in srgb,${TIER_COLORS[tier.id]} 16%,transparent);color:${TIER_COLORS[tier.id]};border:1px solid color-mix(in srgb,${TIER_COLORS[tier.id]} 30%,transparent)">${TIER_SHORT[tier.id]}</span>`:'';
    const e1rmStr=isBW?`BW+${Math.round(e1rm-bw*bwFrac)} kg`:`e1RM ${Math.round(e1rm)} kg`;
    const [yr,mo,dy]=h._d.split('-');
    const dateStr=`${parseInt(mo)}/${parseInt(dy)}/${yr.slice(2)}`;
    return `<div class="lw-row" style="display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px solid var(--bdr);">
      <div style="display:flex;flex-direction:column;gap:3px">
        <span style="font-size:13px;font-weight:700;color:var(--t1)">${fmtWeight(h.weight,name)} × ${h.reps}${h.sets>1?` · ${h.sets} sets`:''}</span>
        <span style="font-size:11px;color:var(--t3)">${dateStr}</span>
      </div>
      ${badgeHtml}
    </div>`;
  }).reverse().join(''); // newest first

  container.innerHTML=buildYouVsOthers(name,p)+`<div class="card" style="margin:0 0 24px;border-radius:14px;overflow:hidden">${rows}</div>`;
}

/* ── RANK-UP / DERANK ANIMATION ── */
function showRankUp(oldTier,oldDiv,newTier,newDiv,isDerank=false,exName=''){
  const ol=document.getElementById('rankUpOverlay');
  if(!ol) return;
  const newColor=TIER_COLORS[newTier]||'#9333EA';
  const color=isDerank?'#e11d48':newColor;
  ol.style.setProperty('--ru-color',color);
  ol.dataset.mode=isDerank?'derank':'rankup';
  // exercise name
  document.getElementById('rankUpExName').textContent=exName;
  // label
  const labelEl=document.getElementById('rankUpLabel');
  labelEl.textContent=isDerank?'RANK LOST':(newTier!==oldTier?'RANK UP':'DIVISION UP');
  labelEl.style.color=isDerank?'#e11d48':'';
  // title (JS-controlled)
  const tierLabel=RANK_TIERS.find(t=>t.id===newTier)?.label||newTier;
  const titleEl=document.getElementById('rankUpTitle');
  titleEl.textContent=`${tierLabel} ${ROMAN[newDiv-1]}`;
  titleEl.style.color=newColor;
  titleEl.style.opacity='0';
  titleEl.style.transform='translateY(18px)';
  titleEl.style.transition='';
  // hint
  const hintEl=document.getElementById('rankUpHint');
  hintEl.style.opacity='0';
  hintEl.style.transition='';
  // icons
  const oldIconEl=document.getElementById('rankUpOldIcon');
  const newIconEl=document.getElementById('rankUpNewIcon');
  const burstEl=document.getElementById('rankUpBurst');
  oldIconEl.innerHTML=rankIconSvg(oldTier,TIER_COLORS[oldTier]||'#7A8A96',{size:100,glow:false,div:oldDiv});
  oldIconEl.classList.remove('ru-exit','ru-shake');
  oldIconEl.style.transform='';oldIconEl.style.opacity='';
  newIconEl.innerHTML=rankIconSvg(newTier,newColor,{size:120,glow:!isDerank,div:newDiv});
  newIconEl.classList.remove('ru-enter','ru-enter-derank');
  // clear any leftover inline styles so CSS defaults (scale(0), opacity:0) take effect
  newIconEl.style.transform='';newIconEl.style.opacity='';newIconEl.style.transition='';
  burstEl.classList.remove('ru-burst');
  document.getElementById('rankUpBurst2').classList.remove('ru-burst');
  document.getElementById('rankUpBurst3').classList.remove('ru-burst');
  document.getElementById('rankUpFlash').classList.remove('ru-flash');
  titleEl.classList.remove('ru-title-in');
  // bar
  const barEl=document.getElementById('rankUpBar');
  const barFillEl=document.getElementById('rankUpBarFill');
  barEl.style.opacity='0';barEl.style.transition='';
  barFillEl.style.width='0%';barFillEl.style.transition='none';
  barFillEl.style.background=color;
  // show
  ol.style.display='flex';
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    ol.classList.remove('ru-out');
    ol.classList.add('ru-in');
    if(isDerank){
      barEl.style.display='none';
      setTimeout(()=>oldIconEl.classList.add('ru-shake'),350);
      setTimeout(()=>{
        oldIconEl.classList.remove('ru-shake');
        oldIconEl.classList.add('ru-exit');
      },950);
      setTimeout(()=>newIconEl.classList.add('ru-enter-derank'),1200);
      setTimeout(()=>{
        titleEl.style.transition='opacity .45s,transform .45s cubic-bezier(.34,1.2,.64,1)';
        titleEl.style.opacity='1';titleEl.style.transform='translateY(0)';
      },1550);
      setTimeout(()=>{hintEl.style.transition='opacity .4s';hintEl.style.opacity='1';},2200);
    } else {
      barEl.style.display='';
      // bar fills
      setTimeout(()=>{
        barEl.style.transition='opacity .2s';barEl.style.opacity='1';
        setTimeout(()=>{barFillEl.style.transition='width 1s ease';barFillEl.style.width='100%';},40);
      },260);
      // EXPLOSION — 3 bursts + flash + old icon spin-out
      setTimeout(()=>{
        barEl.style.transition='opacity .25s';barEl.style.opacity='0';
        oldIconEl.classList.add('ru-exit');
        burstEl.classList.add('ru-burst');
        document.getElementById('rankUpBurst2').classList.add('ru-burst');
        document.getElementById('rankUpBurst3').classList.add('ru-burst');
        document.getElementById('rankUpFlash').classList.add('ru-flash');
      },1300);
      // new icon crashes in
      setTimeout(()=>newIconEl.classList.add('ru-enter'),1480);
      // title slams in
      setTimeout(()=>titleEl.classList.add('ru-title-in'),1800);
      // hint
      setTimeout(()=>{hintEl.style.transition='opacity .4s';hintEl.style.opacity='1';},2600);
    }
  }));
}
function closeRankUp(){
  const ol=document.getElementById('rankUpOverlay');
  if(!ol) return;
  ol.classList.remove('ru-in');
  ol.classList.add('ru-out');
  setTimeout(()=>{
    ol.style.display='none';
    document.getElementById('rankUpOldIcon').classList.remove('ru-exit','ru-shake');
    const ni=document.getElementById('rankUpNewIcon');
    ni.classList.remove('ru-enter','ru-enter-derank');
    ni.style.transform='';ni.style.opacity='';
    document.getElementById('rankUpOldIcon').classList.remove('ru-exit','ru-shake');
    document.getElementById('rankUpBurst').classList.remove('ru-burst');
    document.getElementById('rankUpBurst2').classList.remove('ru-burst');
    document.getElementById('rankUpBurst3').classList.remove('ru-burst');
    document.getElementById('rankUpFlash').classList.remove('ru-flash');
    document.getElementById('rankUpTitle').classList.remove('ru-title-in');
    document.getElementById('rankUpTitle').style.opacity='0';
    document.getElementById('rankUpHint').style.opacity='0';
    ol.classList.remove('ru-out');
    delete ol.dataset.mode;
  },400);
}

function closeExModal(){
  document.getElementById('exOverlay').classList.remove('open');
  document.getElementById('exInputBlock').classList.remove('visible');
  document.getElementById('exBackdrop').classList.remove('visible');
  const _sb=document.querySelector('#exOverlay .sheet-body');
  if(_sb) _sb.scrollTop=0;
  exDay=null;exId=null;exName='';
}

function _makePill(n){
  const p=document.createElement('div');
  p.className='pill'+(n===exName?' active':'');
  p.textContent=n;
  p.addEventListener('click',()=>selectEx(n));
  p.addEventListener('touchstart',()=>p.classList.add('pressing'),{passive:true});
  p.addEventListener('touchend',()=>setTimeout(()=>p.classList.remove('pressing'),150),{passive:true});
  p.addEventListener('touchcancel',()=>p.classList.remove('pressing'),{passive:true});
  return p;
}
function buildPicker(q){
  const wrap=document.getElementById('exPickerList');
  wrap.innerHTML='';
  const _sb=document.querySelector('#exOverlay .sheet-body');
  if(_sb) _sb.scrollTop=0;
  if(q){
    const words=q.toLowerCase().split(/\s+/).filter(Boolean);
    const all=Object.values(EX_DB).flat()
      .filter(n=>{const nl=n.toLowerCase();return words.every(w=>nl.includes(w));})
      .sort((a,b)=>a.localeCompare(b));
    const pills=document.createElement('div'); pills.className='pills';
    all.slice(0,30).forEach(n=>pills.appendChild(_makePill(n)));
    if(!all.length){const m=document.createElement('div');m.style.cssText='font-size:13px;color:var(--t3);padding:6px 0 10px';m.textContent='No match — save below to use as custom.';wrap.appendChild(m);}
    else wrap.appendChild(pills);
  }else{
    Object.entries(EX_DB).forEach(([cat,exs])=>{
      const lbl=document.createElement('div'); lbl.className='cat-lbl'; lbl.textContent=cat; wrap.appendChild(lbl);
      const pills=document.createElement('div'); pills.className='pills';
      [...exs].sort((a,b)=>a.localeCompare(b)).forEach(n=>pills.appendChild(_makePill(n)));
      wrap.appendChild(pills);
    });
  }
}

function isCardio(name){return CARDIO_EX.has(name);}

function updateCardioFields(){
  const cardio=isCardio(exName);
  document.getElementById('strengthFields').style.display=cardio?'none':'block';
  document.getElementById('cardioFields').style.display=cardio?'block':'none';
  updateCardioDisp();
}
function updateCardioDisp(){
  const totalSec=cardioMin*60+cardioSec;
  const distBig=document.getElementById('cardioDistBig');
  const timeBig=document.getElementById('cardioTimeBig');
  if(distBig){
    const km=cardioDist>=1000?(cardioDist/1000).toFixed(cardioDist%1000===0?0:1)+' km':cardioDist+' m';
    distBig.innerHTML=km;
  }
  if(timeBig){
    const m=Math.floor(totalSec/60),s=totalSec%60;
    timeBig.innerHTML=`${m}:${String(s).padStart(2,'0')}<small> min</small>`;
  }
  const speedEl=document.getElementById('cardioSpeedDisp');
  if(cardioDist>0&&totalSec>0){
    const kmh=(cardioDist/1000)/(totalSec/3600);
    speedEl.textContent=`${kmh.toFixed(1)} km/h`;
  } else {
    speedEl.textContent='';
  }
}

function selectEx(name){
  exName=name;
  document.getElementById('exSearch').value=name;
  document.getElementById('exSelectedLbl').textContent=name;
  document.getElementById('exInputBlock').classList.add('visible');document.getElementById('exBackdrop').classList.add('visible');
  if(isCardio(name)){
    cardioDist=0;cardioMin=0;cardioSec=0;
  } else {
    // always ensure values are valid numbers when switching to strength
    if(isNaN(exWeight)||exWeight===undefined||exWeight===null) exWeight=60;
    if(isNaN(exSets)||exSets===undefined||exSets===null) exSets=3;
    if(isNaN(exReps)||exReps===undefined||exReps===null) exReps=8;
    if(BODYWEIGHT_EX.has(name)&&!exId) exWeight=0;
  }
  updateWeightLbl(); updateWeightDisp();
  document.getElementById('setsVal').textContent=exSets;
  document.getElementById('repsVal').textContent=exReps;
  updateCardioFields();
  // update active pill in-place so the press animation isn't cut short
  document.querySelectorAll('#exPickerList .pill').forEach(el=>{
    el.classList.toggle('active',el.textContent===name);
  });
}

function updateWeightLbl(){
  const isBW=BODYWEIGHT_EX.has(exName);
  const isDB=isDumbbell(exName);
  document.getElementById('weightLbl').textContent=isBW?'Added Weight (0 = bodyweight only)':isDB?'Weight per arm':'Weight';
}
function updateWeightDisp(){
  const isBW=BODYWEIGHT_EX.has(exName);
  const isDB=isDumbbell(exName);
  const hint=isBW?`<small>${exWeight===0?'bodyweight only':'kg over BW'}</small>`:isDB?`<small> kg / arm</small>`:`<small> kg</small>`;
  document.getElementById('weightBig').innerHTML=isBW?(exWeight===0?`BW${hint}`:`+${exWeight}${hint}`):`${exWeight}${hint}`;
}

document.getElementById('weightBig').addEventListener('click',()=>{
  const inp=document.getElementById('weightDirect');
  inp.value=exWeight;
  document.getElementById('weightBig').style.display='none';
  inp.style.display='block'; inp.focus(); inp.select();
});
document.getElementById('weightDirect').addEventListener('blur',()=>{
  const v=parseFloat(document.getElementById('weightDirect').value);
  if(!isNaN(v)) exWeight=Math.max(0,Math.min(500,v));
  document.getElementById('weightDirect').style.display='none';
  document.getElementById('weightBig').style.display='';
  updateWeightDisp();
});
document.getElementById('weightDirect').addEventListener('keydown',e=>{if(e.key==='Enter')e.target.blur();});

document.querySelectorAll('.ws-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const d=parseFloat(btn.dataset.d);
    exWeight=btn.classList.contains('minus')?Math.max(0,exWeight-d):Math.min(500,exWeight+d);
    updateWeightDisp();
  });
});
// cardio direct input
function openCardioInp(field){
  if(field==='dist'){
    const big=document.getElementById('cardioDistBig');
    const inp=document.getElementById('cardioDistInp');
    inp.value=cardioDist;
    big.style.display='none'; inp.style.display='block'; inp.focus(); inp.select();
  } else {
    const big=document.getElementById('cardioTimeBig');
    const inp=document.getElementById('cardioTimeInp');
    const m=cardioMin, s=cardioSec;
    inp.value=`${m}:${String(s).padStart(2,'0')}`;
    big.style.display='none'; inp.style.display='block'; inp.focus(); inp.select();
  }
}
document.getElementById('cardioDistInp').addEventListener('blur',()=>{
  const inp=document.getElementById('cardioDistInp');
  const v=parseInt(inp.value);
  if(!isNaN(v)) cardioDist=Math.max(0,v);
  inp.style.display='none';
  document.getElementById('cardioDistBig').style.display='';
  updateCardioDisp();
});
document.getElementById('cardioDistInp').addEventListener('keydown',e=>{if(e.key==='Enter')e.target.blur();});
document.getElementById('cardioTimeInp').addEventListener('blur',()=>{
  const inp=document.getElementById('cardioTimeInp');
  const raw=inp.value.trim();
  const parts=raw.split(':');
  if(parts.length===2){
    const m=parseInt(parts[0]),s=parseInt(parts[1]);
    if(!isNaN(m)&&!isNaN(s)){ cardioMin=Math.max(0,m); cardioSec=Math.max(0,Math.min(59,s)); }
  } else {
    const t=parseInt(raw);
    if(!isNaN(t)){ cardioMin=Math.floor(t/60); cardioSec=t%60; }
  }
  inp.style.display='none';
  document.getElementById('cardioTimeBig').style.display='';
  updateCardioDisp();
});
document.getElementById('cardioTimeInp').addEventListener('keydown',e=>{if(e.key==='Enter')e.target.blur();});

// cardio buttons
document.querySelectorAll('[data-cd]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const d=parseInt(btn.dataset.cd);
    cardioDist=Math.max(0,cardioDist+(btn.classList.contains('minus')?-d:d));
    updateCardioDisp();
  });
});
document.querySelectorAll('[data-ct]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const d=parseInt(btn.dataset.ct);
    let total=cardioMin*60+cardioSec+(btn.classList.contains('minus')?-d:d);
    total=Math.max(0,total);
    cardioMin=Math.floor(total/60); cardioSec=total%60;
    updateCardioDisp();
  });
});

document.getElementById('setsMinus').addEventListener('click',()=>{exSets=Math.max(1,exSets-1);document.getElementById('setsVal').textContent=exSets;});
document.getElementById('setsPlus').addEventListener('click',()=>{exSets=Math.min(20,exSets+1);document.getElementById('setsVal').textContent=exSets;});
document.getElementById('repsMinus').addEventListener('click',()=>{exReps=Math.max(1,exReps-1);document.getElementById('repsVal').textContent=exReps;});
document.getElementById('repsPlus').addEventListener('click',()=>{exReps=Math.min(100,exReps+1);document.getElementById('repsVal').textContent=exReps;});

document.getElementById('exSearch').addEventListener('input',e=>{
  buildPicker(e.target.value);
  if(!e.target.value){exName='';document.getElementById('exInputBlock').classList.remove('visible');document.getElementById('exBackdrop').classList.remove('visible');}
});

document.getElementById('exSave').addEventListener('click',()=>{
  const name=(exName||document.getElementById('exSearch').value).trim();
  if(!name){showToast('Pick or type an exercise name');return;}
  if(!db.history) db.history=[];
  if(!db.schedule[exDay]) db.schedule[exDay]=[];
  // capture per-exercise rank before save
  const p=db.profile;
  const wasEdit=!!exId;
  const _prevExRank=(!isCardio(name)&&db.prs[name]&&p?.weight)?scoreToTierDiv(calcExScore(db.prs[name],p,name)):null;

  // use the schedule entry's id as the stable link to its history row
  const entryId = exId || uid();
  const cardio=isCardio(name);
  const entry=cardio
    ?{id:entryId,name,distance:cardioDist,duration:cardioMin*60+cardioSec}
    :{id:entryId,name,weight:exWeight,sets:exSets,reps:exReps};
  if(exId){
    db.schedule[exDay]=db.schedule[exDay].map(e=>e.id===exId?entry:e);
  }else{
    db.schedule[exDay].push(entry);
  }

  // update or insert the matching history row
  const histEntry=cardio
    ?{name,distance:cardioDist,duration:cardioMin*60+cardioSec,date:new Date().toISOString(),day:exDay,_entryId:entryId}
    :{name,weight:exWeight,sets:exSets,reps:exReps,date:new Date().toISOString(),day:exDay,_entryId:entryId};
  const histIdx=db.history.findIndex(h=>h._entryId===entryId);
  const oldName=histIdx>=0?db.history[histIdx].name:null;
  if(histIdx>=0) db.history[histIdx]=histEntry; else db.history.push(histEntry);

  recomputePR(name);
  if(oldName&&oldName!==name) recomputePR(oldName);
  persist();
  closeExModal();
  renderTodaySession();
  renderWeek();
  renderRankCard();
  renderPRs();
  renderBestPRs();
  showToast(exId?'Exercise updated':'Exercise added');
  // check for per-exercise rank change
  const _newExRank=(!cardio&&db.prs[name]&&p?.weight)?scoreToTierDiv(calcExScore(db.prs[name],p,name)):null;
  if(_newExRank){
    if(!_prevExRank){
      setTimeout(()=>showRankUp('wood',1,_newExRank.tier.id,_newExRank.div,false,name),400);
    } else {
      const prevIdx=RANK_TIERS.findIndex(t=>t.id===_prevExRank.tier.id);
      const newIdx=RANK_TIERS.findIndex(t=>t.id===_newExRank.tier.id);
      const isUp=newIdx>prevIdx||(newIdx===prevIdx&&_newExRank.div>_prevExRank.div);
      const isDown=newIdx<prevIdx||(newIdx===prevIdx&&_newExRank.div<_prevExRank.div);
      if(isUp) setTimeout(()=>showRankUp(_prevExRank.tier.id,_prevExRank.div,_newExRank.tier.id,_newExRank.div,false,name),400);
      else if(isDown) setTimeout(()=>showRankUp(_prevExRank.tier.id,_prevExRank.div,_newExRank.tier.id,_newExRank.div,true,name),400);
    }
  }
});

document.getElementById('exClose').addEventListener('click',closeExModal);
document.getElementById('exOverlay').addEventListener('click',e=>{if(e.target===document.getElementById('exOverlay'))closeExModal();});

/* ── PROFILE MODAL ── */
let selGender = 'm';

function renderProfAvatar(){
  const av=document.getElementById('profAvatar');
  const init=document.getElementById('profInitials');
  if(!av) return;
  const existing=av.querySelector('img');
  if(existing) existing.remove();
  if(db.profile?.avatar){
    const img=document.createElement('img');
    img.src=db.profile.avatar;
    av.appendChild(img);
    if(init) init.style.display='none';
  } else {
    if(init){init.style.display='';init.textContent=(db.profile?.name||'?')[0].toUpperCase();}
  }
}

function openProfile() {
  document.getElementById('inName').value      = db.profile?.name      || '';
  document.getElementById('inWeight').value    = db.profile?.weight    || '';
  document.getElementById('inHeight').value    = db.profile?.height    || '';
  document.getElementById('inAge').value       = db.profile?.age       || '';
  document.getElementById('inInstagram').value = db.profile?.instagram || '';
  document.getElementById('inTiktok').value    = db.profile?.tiktok    || '';
  selGender = db.profile?.gender || 'm';
  document.getElementById('gBtnM').classList.toggle('active', selGender === 'm');
  document.getElementById('gBtnF').classList.toggle('active', selGender === 'f');
  renderProfAvatar();
  const curTheme = localStorage.getItem(THEME_KEY) || 'carbon';
  document.querySelectorAll('.tgrid-btn').forEach(b => b.classList.toggle('on', b.dataset.theme === curTheme));
  const acRow = document.getElementById('profAccountRow');
  if (acRow) {
    if (_user) {
      acRow.innerHTML = `<div class="card" style="padding:12px 14px;display:flex;align-items:center;gap:10px;margin-bottom:4px">
        ${_user.photoURL ? `<img src="${_user.photoURL}" style="width:32px;height:32px;border-radius:50%;flex-shrink:0">` : `<div style="width:32px;height:32px;border-radius:50%;background:var(--acc2);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--acc);flex-shrink:0">${(_user.displayName||'?')[0]}</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_user.displayName||_user.email}</div>
          <div style="font-size:11px;color:var(--t3);margin-top:1px">Synced to cloud ✓</div>
        </div>
        <button class="prf-btn tap-scale" onclick="signOutFirebase()" style="flex-shrink:0;padding:6px 12px;font-size:12px">Sign out</button>
      </div>`;
    } else {
      acRow.innerHTML = `<button onclick="signInWithGoogle()" class="tap-scale" style="width:100%;background:var(--card);border:1.5px solid var(--bdr);border-radius:14px;padding:12px 14px;display:flex;align-items:center;justify-content:center;gap:10px;font-size:14px;font-weight:700;color:var(--text);font-family:inherit;cursor:pointer;margin-bottom:4px">
        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        Continue with Google
      </button>`;
    }
  }
  openOverlay('profileOverlay');
}

function closeProfile() {
  document.getElementById('profileOverlay').classList.remove('open');
}

// avatar photo button → file picker
document.getElementById('profAvatarBtn').addEventListener('click',()=>document.getElementById('profAvatarInput').click());
document.getElementById('profAvatarInput').addEventListener('change',e=>{
  const file=e.target.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    // resize to 256px canvas before storing
    const img=new Image();
    img.onload=()=>{
      const size=256;
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=size;
      const ctx=canvas.getContext('2d');
      const s=Math.min(img.width,img.height);
      const ox=(img.width-s)/2, oy=(img.height-s)/2;
      ctx.drawImage(img,ox,oy,s,s,0,0,size,size);
      if(!db.profile) db.profile={};
      db.profile.avatar=canvas.toDataURL('image/jpeg',0.8);
      persist();
      renderProfAvatar();
      renderProfileTab();
      syncPublicProfile();
    };
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value='';
});

document.getElementById('profBgBtn').addEventListener('click',()=>document.getElementById('profBgInput').click());
document.getElementById('profBgInput').addEventListener('change',e=>{
  const file=e.target.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    const img=new Image();
    img.onload=()=>{
      const W=800,H=500;
      const canvas=document.createElement('canvas');
      canvas.width=W;canvas.height=H;
      const ctx=canvas.getContext('2d');
      const scale=Math.max(W/img.width,H/img.height);
      const sw=img.width*scale,sh=img.height*scale;
      ctx.drawImage(img,(W-sw)/2,(H-sh)/2,sw,sh);
      if(!db.profile) db.profile={};
      db.profile.heroBg=canvas.toDataURL('image/jpeg',0.75);
      persist();
      renderProfileTab();
      syncPublicProfile();
      showToast('Background updated');
    };
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value='';
});

document.getElementById('profileClose').addEventListener('click', closeProfile);
document.getElementById('profileOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('profileOverlay')) closeProfile();
});

document.getElementById('gBtnM').addEventListener('click', () => {
  selGender = 'm';
  document.getElementById('gBtnM').classList.add('active');
  document.getElementById('gBtnF').classList.remove('active');
});
document.getElementById('gBtnF').addEventListener('click', () => {
  selGender = 'f';
  document.getElementById('gBtnF').classList.add('active');
  document.getElementById('gBtnM').classList.remove('active');
});

document.getElementById('profileSave').addEventListener('click', () => {
  const w = parseFloat(document.getElementById('inWeight').value);
  const h = parseFloat(document.getElementById('inHeight').value);
  const a = parseInt(document.getElementById('inAge').value);
  if (!w || w < 30)            { showToast('Enter a valid weight (30–200 kg)'); return; }
  if (!h || h < 140 || h > 220){ showToast('Enter a valid height (140–220 cm)'); return; }
  db.profile.name      = document.getElementById('inName').value.trim();
  db.profile.weight    = w;
  db.profile.height    = h;
  db.profile.age       = a || null;
  db.profile.gender    = selGender;
  db.profile.instagram = document.getElementById('inInstagram').value.trim().replace(/^@/,'') || null;
  db.profile.tiktok    = document.getElementById('inTiktok').value.trim().replace(/^@/,'') || null;
  persist();
  // keep friend code name in sync
  if (_user && db.friendCode) {
    _codesCol().doc(db.friendCode).set({ name: db.profile.name || _user.displayName || 'Athlete' }, { merge: true }).catch(() => {});
  }
  syncPublicProfile();
  closeProfile();
  renderHomeBar();
  renderRankCard();
  renderTodaySession();
  renderProfileTab();
  showToast('Profile saved');
});

/* ── TOAST ── */
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  if (toastTimer) clearTimeout(toastTimer);
  t.classList.add('show');
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ── TIMER removed ── */

function fmtTime(s){return`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}


const NOTIF_ICON = new URL('./icon-192_no_bg.png', location.href).href;
let _swReg = null;
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js');
  navigator.serviceWorker.ready.then(r => _swReg = r);
}

async function sendNotif(title, body){
  if(!db.notif?.enabled) return;
  if(typeof Notification==='undefined' || Notification.permission!=='granted') return;
  const opts = {body, icon:NOTIF_ICON, tag:'gymlog-timer', renotify:true, vibrate:[200,100,200]};
  try{
    const reg = _swReg || await navigator.serviceWorker.ready;
    reg.showNotification(title, opts);
  }catch(e){
    try{ new Notification(title, opts); }catch(_){}
  }
}



/* ── SETTINGS ── */
const THEME_KEY = 'gymlog_theme';

const THEMES = {
  carbon:   { bg:'#131210', bg2:'#1C1B19', card:'#242320', card2:'#2D2C2A', bdr:'#373530', bdr2:'rgba(168,166,160,.16)', text:'#F2F1EE', t2:'#8A8880', t3:'#4A4845', acc:'#9E9C96', acc2:'rgba(168,166,160,.12)',acc3:'rgba(168,166,160,.07)',meta:'#131210' },
  volt:     { bg:'#1A1B1A', bg2:'#22231F', card:'#2B2C28', card2:'#343531', bdr:'#3D3E3A', bdr2:'rgba(180,218,120,.16)', text:'#F3F5F2', t2:'#8E968F', t3:'#4F524E', acc:'#B4DA78', acc2:'rgba(180,218,120,.12)',  acc3:'rgba(180,218,120,.07)',  meta:'#1A1B1A' },
  forest:   { bg:'#161816', bg2:'#1F211F', card:'#252725', card2:'#2D2F2D', bdr:'#333533', bdr2:'rgba(122,158,154,.20)', text:'#F2F4F2', t2:'#8A9490', t3:'#4A5452', acc:'#7A9E9A', acc2:'rgba(122,158,154,.14)',acc3:'rgba(122,158,154,.08)',meta:'#161816' },
  night:    { bg:'#1B1A1C', bg2:'#232228', card:'#2C2B31', card2:'#353338', bdr:'#3E3C44', bdr2:'rgba(196,168,232,.16)', text:'#F7F4FA', t2:'#96909D', t3:'#545258', acc:'#C4A8E8', acc2:'rgba(196,168,232,.13)',acc3:'rgba(196,168,232,.07)',meta:'#1B1A1C' },
  burnt:    { bg:'#1C1A18', bg2:'#252220', card:'#2E2B28', card2:'#373430', bdr:'#413D39', bdr2:'rgba(232,174,138,.18)', text:'#F7F3EE', t2:'#9A9088', t3:'#565250', acc:'#E8AE8A', acc2:'rgba(232,174,138,.13)',acc3:'rgba(232,174,138,.07)',meta:'#1C1A18' },
  softcarb: { bg:'#F3F2F0', bg2:'#ECEAE8', card:'#FAFAF8', card2:'#EDECEA', bdr:'#DCDAD7', bdr2:'rgba(100,98,92,.14)',   text:'#151412', t2:'#787670', t3:'#B4B2AC', acc:'#848280', acc2:'rgba(100,98,92,.10)',   acc3:'rgba(100,98,92,.06)',   meta:'#F3F2F0' },
  fresh:    { bg:'#F3F6F3', bg2:'#EDF0EE', card:'#F8FAF8', card2:'#E8EEE9', bdr:'#D9E0DA', bdr2:'rgba(118,162,62,.16)',  text:'#111511', t2:'#707870', t3:'#B5C0B6', acc:'#76A23E', acc2:'rgba(118,162,62,.11)',   acc3:'rgba(118,162,62,.07)',   meta:'#F3F6F3' },
  sage:     { bg:'#E0E2DB', bg2:'#EAEBE6', card:'#F0F1EC', card2:'#E6E8E2', bdr:'#D2D4C8', bdr2:'rgba(95,116,112,.18)',  text:'#1A1C1A', t2:'#707872', t3:'#B8BDB5', acc:'#5F7470', acc2:'rgba(95,116,112,.12)',  acc3:'rgba(95,116,112,.07)',  meta:'#E0E2DB' },
  lavender: { bg:'#F6F4F8', bg2:'#F0EDF3', card:'#FAF8FC', card2:'#ECE8F0', bdr:'#DED9E3', bdr2:'rgba(158,120,210,.14)', text:'#17131C', t2:'#78727E', t3:'#C0BAC7', acc:'#9E78D2', acc2:'rgba(158,120,210,.11)', acc3:'rgba(158,120,210,.07)', meta:'#F6F4F8' },
  cream:    { bg:'#F7F4EF', bg2:'#F1EDE6', card:'#FBF8F4', card2:'#EDE8DF', bdr:'#DED8CF', bdr2:'rgba(198,126,94,.15)', text:'#1B1714', t2:'#827A73', t3:'#C3BCB4', acc:'#C67E5E', acc2:'rgba(198,126,94,.11)',   acc3:'rgba(198,126,94,.07)',   meta:'#F7F4EF' },
};

function applyTheme(t, save=true){
  const th = THEMES[t] || THEMES.carbon;
  const r = document.documentElement.style;
  const mc = document.getElementById('metaThemeColor');
  if (mc) mc.content = th.bg;
  r.setProperty('--bg',    th.bg);
  r.setProperty('--bg2',   th.bg2);
  r.setProperty('--card',  th.card);
  r.setProperty('--card2', th.card2);
  r.setProperty('--bdr',   th.bdr);
  r.setProperty('--bdr2',  th.bdr2);
  r.setProperty('--text',  th.text);
  r.setProperty('--t2',    th.t2);
  r.setProperty('--t3',    th.t3);
  r.setProperty('--acc',   th.acc);
  r.setProperty('--acc2',  th.acc2);
  r.setProperty('--acc3',  th.acc3);
  document.querySelectorAll('.tgrid-btn').forEach(b=>b.classList.toggle('on', b.dataset.theme===t));
  localStorage.setItem(THEME_KEY, t);
  if (save && db.profile) { db.profile.theme = t; persist(); }
  document.querySelector('meta[name="theme-color"]').setAttribute('content', th.meta);
}

function updateNotifToggle(){
  const on = !!db.notif?.enabled;
  const btn = document.getElementById('notifToggle');
  if(btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

async function toggleNotif(){
  if(db.notif?.enabled){
    db.notif.enabled=false; persist(); updateNotifToggle(); showToast('Notifications off'); return;
  }
  if(!('Notification' in window)){showToast('Notifications not supported on this browser');return;}
  if(Notification.permission==='denied'){showToast('Notifications blocked — enable in phone settings');return;}
  let perm = Notification.permission;
  if(perm !== 'granted') perm = await Notification.requestPermission();
  if(perm!=='granted'){showToast('Permission not granted');return;}
  if(!db.notif) db.notif={};
  db.notif.enabled=true; persist(); updateNotifToggle(); showToast('Notifications enabled!');
  sendNotif('GymLog ✓', 'Timer notifications are on.');
}

function openSettings(){
  updateNotifToggle();
  openOverlay('settingsOverlay');
}
function closeSettings(){
  document.getElementById('settingsOverlay').classList.remove('open');
}


document.getElementById('settingsClose').addEventListener('click', closeSettings);
document.getElementById('settingsOverlay').addEventListener('click', e=>{
  if(e.target===document.getElementById('settingsOverlay')) closeSettings();
});

document.getElementById('themeGrid').addEventListener('click', e=>{
  const btn = e.target.closest('.tgrid-btn');
  if(btn) applyTheme(btn.dataset.theme);
});

document.getElementById('notifToggle').addEventListener('click', toggleNotif);

document.getElementById('btnImportData').addEventListener('click', ()=>{
  document.getElementById('importFileInput').click();
});
document.getElementById('importFileInput').addEventListener('change', e=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev=>{
    try{
      const parsed = JSON.parse(ev.target.result);
      if(!parsed.history || !Array.isArray(parsed.history)) throw new Error('Invalid file');
      Object.assign(db, parsed);
      persist();
      showToast('Data imported — reloading…');
      setTimeout(()=>location.reload(), 1200);
    }catch(err){
      showToast('Import failed: invalid file');
    }
  };
  reader.readAsText(file);
  e.target.value='';
});

document.getElementById('btnExportData').addEventListener('click', ()=>{
  const json = JSON.stringify(db, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=`gymlog-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
  showToast('Data exported');
});

document.getElementById('btnClearData').addEventListener('click', ()=>{
  if(!confirm('Delete all your gym data? This cannot be undone.')) return;
  localStorage.removeItem('gymlog_v4');
  sessionStorage.removeItem('gymlog_scr');
  location.reload();
});

/* ── INIT: validate all PRs against history ── */
(function validatePRs(){
  let dirty=false;
  Object.keys(db.prs).forEach(name=>{
    const hasHistory=db.history.some(h=>h.name===name);
    if(!hasHistory){delete db.prs[name];dirty=true;return;}
    recomputePR(name);dirty=true;
  });
  if(dirty) persist();
})();

/* ── INIT ── */
renderHomeBar();
renderRankCard();
renderTodaySession();
renderPRs();
renderBestPRs();
applyTheme(localStorage.getItem(THEME_KEY)||'carbon');

/* ── SPLASH DISMISS ── */
(function(){
  const splash=document.getElementById('splash');
  if(!splash) return;
  const r=calcOverallRank();
  const color=r?TIER_COLORS[r.tier.id]:'var(--acc)';
  const rankLabel=r?`${r.tier.label} ${ROMAN[r.div-1]}`:'Wood I';
  document.getElementById('splash-logo').innerHTML=rankIconSvg(r?r.tier.id:'wood',color,{size:140,glow:true,div:r?r.div:1});
  document.getElementById('splash-wordmark').textContent=rankLabel;

  let fontsReady=false, authReady=false, barDone=false;
  function dismiss(){
    splash.classList.add('hide');
    setTimeout(()=>splash.remove(),600);
  }
  function tryDismiss(){
    if(barDone||(fontsReady&&authReady)) dismiss();
  }

  // bar completion always forces dismiss
  const barFill=document.getElementById('splash-bar-fill');
  if(barFill) barFill.addEventListener('animationend',()=>{barDone=true;dismiss();},{once:true});

  // pre-render all tabs while splash is showing
  renderTodaySession(); renderWeek(); renderPRs(); renderBestPRs(); renderRankCard(); renderFriendsTab(); renderProfileTab();

  const fontsTimeout=setTimeout(()=>{fontsReady=true;tryDismiss();},1700);
  if(document.fonts){
    document.fonts.ready.then(()=>{clearTimeout(fontsTimeout);setTimeout(()=>{fontsReady=true;tryDismiss();},400);});
  }

  // wait for Firebase auth to resolve before dismissing
  const unsub=_auth.onAuthStateChanged(()=>{
    unsub();
    authReady=true;
    tryDismiss();
  });
})();

/* ── DAILY NUDGE ── */
(function scheduleDailyNudge(){
  if(!db.notif?.enabled) return;
  if(typeof Notification==='undefined'||Notification.permission!=='granted') return;
  const today = todayDateStr();
  const lastSent = localStorage.getItem('gymlog_nudge_date');
  if(lastSent === today) return;

  const exs = usualExsForDate(today);
  const pick = exs.length ? exs[Math.floor(Math.random()*exs.length)].name : null;

  const MSGS = pick ? [
    [`Ready to hit ${pick}? 💪`, 'Your usual session is waiting.'],
    [`Time to crush ${pick}! 🔥`, "Don't let the bar down."],
    [`${pick} day! 🏋️`, 'Get after it.'],
    [`Don't skip ${pick} today`, 'Consistency builds champions.'],
    [`Let's go — ${pick} is waiting`, 'You got this.'],
  ] : [
    ['Time to train 💪', 'Your session is waiting.'],
    ['Gym day! 🔥', "Don't skip — you'll thank yourself later."],
  ];
  const [title, body] = MSGS[Math.floor(Math.random()*MSGS.length)];

  // Schedule for 10:00 today, or 10min from now if already past 10
  const now = new Date();
  const target = new Date(now);
  target.setHours(10, 0, 0, 0);
  if(target <= now) target.setMinutes(now.getMinutes()+10);
  const delay = target - now;

  localStorage.setItem('gymlog_nudge_date', today);
  navigator.serviceWorker.ready.then(reg => {
    reg.active?.postMessage({type:'SCHEDULE_DAILY', delay, title, body});
  });
})();

/* ── PULL-TO-REFRESH ── */
(function(){
  const THRESHOLD=220;
  let startY=0,pulling=false,triggered=false;

  function getScr(){return document.querySelector('.scr.on');}
  function reset(scr){if(scr){scr.style.transition='none';scr.style.transform='';}}

  document.addEventListener('touchstart',e=>{
    if(document.querySelector('.overlay.open')) return;
    if(e.target.closest('.sheet,.overlay')) return;
    const sb=document.querySelector('.scr.on .sb');
    if(!sb||sb.scrollTop>0) return;
    startY=e.touches[0].clientY;
    pulling=true;triggered=false;
  },{passive:true});

  document.addEventListener('touchmove',e=>{
    if(!pulling||triggered)return;
    const dy=e.touches[0].clientY-startY;
    const scr=getScr();
    if(dy<=0){reset(scr);return;}
    if(scr){scr.style.transition='none';scr.style.transform=`translateY(${Math.min(dy*0.25,50)}px)`;}
  },{passive:true});

  document.addEventListener('touchend',e=>{
    if(!pulling)return;
    pulling=false;
    const scr=getScr();
    const dy=e.changedTouches[0].clientY-startY;
    if(dy>=THRESHOLD&&!triggered){
      triggered=true;
      reset(scr);
      location.reload();
    } else {
      reset(scr);
    }
  },{passive:true});

  document.addEventListener('touchcancel',()=>{
    if(!pulling)return;
    pulling=false;
    reset(getScr());
  },{passive:true});
})();

