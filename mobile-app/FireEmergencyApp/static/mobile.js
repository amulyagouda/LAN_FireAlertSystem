// mobile.js - COMPLETE CODE WITH PWA PUSH SUBSCRIPTION

// --- CONFIGURATION ---
// ⚠️ IMPORTANT: Change SERVER_IP to your computer's IP address/hostname
const SERVER_IP = '127.0.0.1'; 
const WS_URL = `ws://${SERVER_IP}:8080/ws/client`;
const VAPID_PUBLIC_KEY = 'BFDEaXGOljN6qPbyKsiBRJCl1pk7SNd6nhEbFTR5X35Stj1b-e56AEATm-JbvS81EFF4utZ9oFi0YcmDhkJVmyU'; // <-- REPLACE THIS with your actual VAPID Public Key

// --- DOM elements ---
const connectionStatus = document.getElementById('connectionStatus');
const connectionText = document.getElementById('connectionText');
const alertBanner = document.getElementById('alertBanner');
const alertMessage = document.getElementById('alertMessage');
const statusMessage = document.getElementById('statusMessage');
const mapDisplay = document.getElementById('mapDisplay');
const alertSound = document.getElementById('alertSound');
const notificationPrompt = document.getElementById('notificationPrompt');

// --- Global state ---
let ws = null;
let clientId = null;
let reconnectInterval = null;
let alertShown = false;
let sirenInterval = null;
let flashTitleInterval = null;


// ===================================
//         PWA UTILITY FUNCTIONS
// ===================================

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Function to handle the subscription process
async function subscribeToPush() {
    if (Notification.permission !== 'granted' || VAPID_PUBLIC_KEY === 'YOUR_VAPID_PUBLIC_KEY_HERE') {
        return;
    }

    try {
        const registration = await navigator.serviceWorker.ready;
        
        // 1. Create the subscription object
        const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey
        });

        console.log('Push subscription success:', subscription);
        
        // 2. Send the subscription to your server's API
        const response = await fetch(`https://${SERVER_IP}/api/subscribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(subscription),
        });
        
        if (response.ok) {
            console.log('Subscription sent to server successfully.');
        } else {
            console.error('Failed to send subscription to server.');
        }

    } catch (e) {
        console.error('Failed to subscribe to push:', e);
    }
}


// ===================================
//         CORE FUNCTIONALITY
// ===================================

// WebSocket Connection
function connectWebSocket() {
    try {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            console.log('✓ Connected to server');
            connectionStatus.className = 'status-indicator connected';
            connectionText.textContent = 'Connected';
            updateStatus('✅ Connected to emergency server. Ready.', false);
            
            if (reconnectInterval) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleMessage(data);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            connectionStatus.className = 'status-indicator disconnected';
            connectionText.textContent = 'Connection Error';
        };

        ws.onclose = () => {
            console.log('✗ Disconnected from server');
            connectionStatus.className = 'status-indicator disconnected';
            connectionText.textContent = 'Disconnected';
            updateStatus('⚠️ Connection lost. Reconnecting...', false);
            
            // Auto-reconnect
            if (!reconnectInterval) {
                reconnectInterval = setInterval(() => {
                    console.log('Attempting to reconnect...');
                    connectWebSocket();
                }, 3000);
            }
        };
    } catch (error) {
        console.error('Connection error:', error);
    }
}

// Handle incoming messages
function handleMessage(data) {
    console.log('Message received:', data.type);

    switch (data.type) {
        case 'connected':
            clientId = data.client_id;
            console.log('Client ID:', clientId);
            break;

        case 'fire_alert':
            handleFireAlert(data);
            break;

        case 'broadcast':
            handleBroadcast(data);
            break;
            
        case 'clear_alert': // 💡 Handles the specific server message to stop alarm
            handleAllClear(data.message);
            break;

        case 'admin_message':
            updateStatus(`📢 ${data.message}`, false); 
            break;
    }
}

// Handle fire alert (Plays siren, vibrates, shows notification)
function handleFireAlert(data) {
    const smokeLevel = data.smoke_level || 'Unknown';
    const sensorId = data.sensor_id || 'Unknown';

    alertBanner.classList.add('active');
    alertMessage.textContent = `${data.message} | Smoke: ${smokeLevel} | Sensor: ${sensorId}`;
    
    updateStatus(`🚨 FIRE ALERT! Smoke: ${smokeLevel} | Sensor: ${sensorId}`, true);

    startSiren(); 

    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 200]);
    }

    if (!alertShown) {
        // This is a foreground notification; background is handled by the Service Worker
        showNotification('🔥 FIRE ALERT', `${data.message}\nSmoke Level: ${smokeLevel}`);
        alertShown = true;
    }
    
    flashTitle(); 
}

// Handle ALL CLEAR message (via clear_alert type)
function handleAllClear(message) {
    alertBanner.classList.remove('active');
    alertShown = false;
    stopSiren();
    updateStatus(`✅ All Clear - ${message}`, false);
}


// Handle broadcast messages (ALL CLEAR logic, map display, general messages)
function handleBroadcast(data) {
    const message = data.message || '';
    
    // Display map if available
    if (data.map_data) {
        const filename = data.map_filename || 'Evacuation Map';
        displayMap(data.map_data);
        updateStatus(`🗺️ New Evacuation Route: ${filename}`, false);
    }

    // Display message
    if (message) {
        updateStatus(`📢 Admin: ${message}`, false);
    }
}

// Function triggered by the Quick Response Panel buttons (Your existing function)
function sendStatus(status) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Not connected to server. Please wait...');
        return;
    }

    const message = {
        type: 'status_update',
        status: status,
        timestamp: new Date().toISOString()
    };

    ws.send(JSON.stringify(message));

    // Visual feedback
    const statusMessages = {
        'SAFE': '✅ Status: SAFE - Stay alert for instructions',
        'NEED_HELP': '⚠️ Status: NEED HELP - Responders alerted!',
        'INJURED': '🩹 Status: INJURED - Medical assistance notified!',
        'TRAPPED': '🚪 Status: TRAPPED - Emergency services notified!'
    };

    updateStatus(statusMessages[status], status !== 'SAFE');
    
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
    setTimeout(() => {
        alert(`Status reported: ${status}`);
    }, 100);
}


// ===================================
//         UTILITY FUNCTIONS
// ===================================

function updateStatus(message, isAlert) {
    statusMessage.textContent = message;
    statusMessage.className = isAlert ? 'status-message alert' : 'status-message';
}

function displayMap(base64Data) {
    mapDisplay.innerHTML = `<img src="${base64Data}" alt="Evacuation Map">`;
}

// Siren functions 
function startSiren() {
    if (sirenInterval) return;

    sirenInterval = setInterval(() => {
        alertSound.currentTime = 0;
        alertSound.play().catch(e => console.log('Audio play failed:', e));
    }, 2000);
}

function stopSiren() {
    if (sirenInterval) {
        clearInterval(sirenInterval);
        sirenInterval = null;
    }
    alertSound.pause();
}

// Flash page title
function flashTitle() {
    if (flashTitleInterval) return;

    const originalTitle = document.title;
    let isAlert = true;

    flashTitleInterval = setInterval(() => {
        document.title = isAlert ? '🚨 FIRE ALERT! 🚨' : originalTitle;
        isAlert = !isAlert;
    }, 1000);

    // Stop after 30 seconds
    setTimeout(() => {
        clearInterval(flashTitleInterval);
        flashTitleInterval = null;
        document.title = originalTitle;
    }, 30000);
}

// Notification functions
function checkNotificationPermission() {
    if (!('Notification' in window)) {
        notificationPrompt.classList.add('hidden');
        return;
    }

    if (Notification.permission === 'granted') {
        notificationPrompt.classList.add('hidden');
    } else if (Notification.permission === 'denied') {
        notificationPrompt.classList.add('hidden');
    }
}

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        alert('Notifications not supported on this device');
        return;
    }

    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            notificationPrompt.classList.add('hidden');
            showNotification('Notifications Enabled', 'You will receive emergency alerts');
            
            // CRITICAL: Start the subscription process after permission is granted
            subscribeToPush();
        }
    });
}

function showNotification(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
        return;
    }

    const notification = new Notification(title, {
        body: body,
        icon: '🚨',
        badge: '🔥',
        vibrate: [200, 100, 200],
        requireInteraction: true
    });

    notification.onclick = () => {
        window.focus();
        notification.close();
    };
}

// Service Worker Registration
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.log('Service worker registration failed:', err);
        });
    }
}


// --- INITIALIZATION ---
window.addEventListener('load', () => {
    connectWebSocket();
    checkNotificationPermission();
    registerServiceWorker(); 
    
    // Attempt to subscribe immediately if permission is already granted (after SW is ready)
    if (Notification.permission === 'granted') {
        navigator.serviceWorker.ready.then(() => {
             subscribeToPush();
        });
    }
});


// --- EXPORTS for HTML/DOM ---
window.connectWebSocket = connectWebSocket;
window.requestNotificationPermission = requestNotificationPermission;
window.sendStatus = sendStatus;