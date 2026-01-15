// sw.js (Service Worker for PWA functionality)

// A list of assets to cache for offline/fast loading
const CACHE_NAME = 'emergency-cache-v1';
const urlsToCache = [
    '/', // mobile.html
    '/static/mobile.js', 
    '/static/client_v2.css', // Assuming client_v2.css is used by mobile.html
    // Note: The audio data is inline, so no separate audio file is needed.
];

// 1. Installation: Cache all essential assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

// 2. Fetch: Serve cached assets when offline
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Cache hit - return response
                if (response) {
                    return response;
                }
                // No match in cache - fetch from network
                return fetch(event.request);
            })
    );
});

// 3. PUSH: Handle Push Notifications (Crucial for background alerts)
self.addEventListener('push', (event) => {
    const data = event.data.json();
    console.log('[Service Worker] Push Received.');

    // Display the notification
    const title = data.title || '🔥 EMERGENCY ALERT';
    const options = {
        body: data.body || 'Please check your status immediately.',
        icon: '🚨',
        badge: '🔥',
        vibrate: [200, 100, 200, 100, 200],
        requireInteraction: true, // Keeps notification visible until clicked
        data: {
            url: clients.claim().url // URL to open when clicked
        }
    };

    // The notification is shown here
    event.waitUntil(self.registration.showNotification(title, options));

    // 💡 BACKGROUND ALARM: The siren logic is difficult to run reliably in a Service Worker
    // when the screen is locked, as browsers restrict background audio.
    // However, the PUSH event itself can trigger a temporary "wake-up."
    
    // For a guaranteed siren, the server needs to use Push API's vibration/sound options,
    // but since we are using WebSockets, we rely on the client being open or the notification being clicked.
    
    // The most reliable background siren is achieved by the notification's VIBRATE/SOUND options
    // and requiring user interaction (click) to open the app, where the main JS takes over the siren.
});

// 4. Notification Click: Open the app when the user clicks the notification
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            for (const client of clientList) {
                // If the app is already open, focus on it
                if (client.url === client.data.url && 'focus' in client) {
                    return client.focus();
                }
            }
            // If the app is closed, open a new window/tab to the app URL
            if (clients.openWindow) {
                return clients.openWindow(client.data.url);
            }
        })
    );
});

// 5. Activation: Claim control of the page immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});