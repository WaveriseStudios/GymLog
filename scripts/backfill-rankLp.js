// Paste this in the browser console on https://waverisestudios.github.io/GymLog/
// while signed in. It sets rankLp:0 for every public profile that is missing it.
// Users' real LP is written by syncPublicProfile() the next time they open the app.

(async () => {
  const db = firebase.firestore();
  const col = db.collection('publicProfiles');
  const snap = await col.get();
  const batch = db.batch();
  let count = 0;
  snap.forEach(doc => {
    const d = doc.data();
    if (d.rankTier && d.rankLp == null) {
      batch.update(doc.ref, { rankLp: 0 });
      count++;
    }
  });
  if (count === 0) { console.log('Nothing to backfill.'); return; }
  await batch.commit();
  console.log(`Done — backfilled rankLp:0 on ${count} profile(s).`);
})();
