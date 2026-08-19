/* GymLog Service Worker */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

let timerTimeout = null

self.addEventListener('message', e => {
  const { type } = e.data || {}

  if (type === 'TICK') {
    const { timeLeft, presetName } = e.data
    const m = Math.floor(timeLeft / 60)
    const s = String(timeLeft % 60).padStart(2, '0')
    self.registration.showNotification(`⏱ ${m}:${s} — ${presetName}`, {
      body: 'Rest timer running. Tap to open.',
      icon: new URL('./icon-192.png', self.location).href,
      badge: new URL('./icon-192.png', self.location).href,
      tag: 'gymlog-tick',
      renotify: false,
      silent: true,
    })
  }

  if (type === 'SCHEDULE_TIMER') {
    const { endsAt, presetName } = e.data
    clearTimeout(timerTimeout)
    const delay = Math.max(0, endsAt - Date.now())
    timerTimeout = setTimeout(() => {
      self.registration.getNotifications({ tag: 'gymlog-tick' })
        .then(ns => ns.forEach(n => n.close()))
      self.registration.showNotification('💪 Rest done — back to it!', {
        body: `${presetName} complete. Time to lift.`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'gymlog-timer',
        renotify: true,
        vibrate: [200, 100, 200, 100, 400],
      })
    }, delay)
  }

  if (type === 'CANCEL_TIMER') {
    clearTimeout(timerTimeout)
    timerTimeout = null
    self.registration.getNotifications({ tag: 'gymlog-tick' })
      .then(ns => ns.forEach(n => n.close()))
    self.registration.getNotifications({ tag: 'gymlog-timer' })
      .then(ns => ns.forEach(n => n.close()))
  }
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const match = clients.find(c => c.url.includes(self.location.origin))
      if (match) return match.focus()
      return self.clients.openWindow('/')
    })
  )
})
