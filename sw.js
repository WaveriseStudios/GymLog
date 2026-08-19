/* GymLog Service Worker */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

const ICON = new URL('./icon-192.png', self.location).href
let timerTimeout = null
let dailyTimeout = null

self.addEventListener('message', e => {
  const { type } = e.data || {}

  if (type === 'SCHEDULE_TIMER') {
    const { endsAt, presetName } = e.data
    clearTimeout(timerTimeout)
    const delay = Math.max(0, endsAt - Date.now())
    timerTimeout = setTimeout(() => {
      self.registration.showNotification('💪 Rest done — back to it!', {
        body: `${presetName} complete. Time to lift.`,
        icon: ICON, badge: ICON,
        tag: 'gymlog-timer',
        renotify: true,
        vibrate: [200, 100, 200, 100, 400],
      })
    }, delay)
  }

  if (type === 'CANCEL_TIMER') {
    clearTimeout(timerTimeout)
    timerTimeout = null
    self.registration.getNotifications({ tag: 'gymlog-timer' })
      .then(ns => ns.forEach(n => n.close()))
  }

  if (type === 'SCHEDULE_DAILY') {
    const { delay, title, body } = e.data
    clearTimeout(dailyTimeout)
    dailyTimeout = setTimeout(() => {
      self.registration.showNotification(title, {
        body, icon: ICON, badge: ICON,
        tag: 'gymlog-daily',
        renotify: true,
        vibrate: [200, 100, 200],
      })
    }, delay)
  }

  if (type === 'CANCEL_DAILY') {
    clearTimeout(dailyTimeout)
    dailyTimeout = null
  }
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const match = clients.find(c => c.url.includes(self.location.origin))
      if (match) return match.focus()
      return self.clients.openWindow('./')
    })
  )
})
