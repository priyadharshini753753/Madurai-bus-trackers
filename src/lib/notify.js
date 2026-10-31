export const notificationsSupported = () => typeof Notification !== 'undefined'
export const notificationPermission = () => (notificationsSupported() ? Notification.permission : 'unsupported')

export async function askNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported'
  try { return await Notification.requestPermission() } catch { return Notification.permission }
}

/** Shows a system notification if allowed. Always also raises an in-app toast. */
export async function notify(title, body) {
  window.dispatchEvent(new CustomEvent('mbt:toast', { detail: { title, body } }))
  if (notificationPermission() !== 'granted') return false
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg?.showNotification) await reg.showNotification(title, { body, icon: '/icon-192.png', tag: title })
    else new Notification(title, { body, icon: '/icon-192.png' })
    return true
  } catch { return false }
}
