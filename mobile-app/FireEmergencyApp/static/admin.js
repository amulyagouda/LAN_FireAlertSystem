// admin.js

let ws = null;
let authToken = null;
let selectedMapFile = null;
const SERVER_URL = `ws://${window.location.hostname}:8080`;
const HTTP_API_URL = `http://${window.location.hostname}:8080/api/admin`;

// 🎯 NEW: LIST OF APPROVED MAP FILENAMES (CRITICAL SECURITY CHECK)
const APPROVED_MAP_FILENAMES = [
    "emergency-evacuation-plan-1.png",
    "emergency-evacuation-plan-2.jpg",
    "emergency-evacuation-plan-3.png"
];

// ===== AUTHENTICATION (Unchanged) =====
async function login(event) {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch(`${HTTP_API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            authToken = data.token;
            logActivity('System', `Admin ${username} logged in successfully`);
            showDashboard();
            connectWebSocket();
        } else {
            alert('❌ Invalid credentials. Please check your username and password.');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('❌ Login failed. Please check your connection to the server.');
    }
}

function showDashboard() {
    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('dashboard').classList.add('active');
}

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        if (ws) ws.close();
        authToken = null;
        logActivity('System', 'Admin logged out');
        document.getElementById('loginContainer').style.display = 'flex';
        document.getElementById('dashboard').classList.remove('active');
        document.getElementById('loginForm').reset();
    }
}

// ===== WEBSOCKET CONNECTION (Unchanged) =====
function connectWebSocket() {
    ws = new WebSocket(`${SERVER_URL}/ws/admin`);
    const statusDot = document.querySelector('.status-dot');

    ws.onopen = () => {
        document.getElementById('connectionStatus').textContent = 'Connected to System';
        statusDot.style.background = '#10b981'; // Green
        logActivity('System', 'WebSocket connection established');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };

    ws.onclose = () => {
        document.getElementById('connectionStatus').textContent = 'Disconnected - Reconnecting...';
        statusDot.style.background = '#f59e0b'; // Orange
        logActivity('System', 'Connection lost. Attempting to reconnect...', true);
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
        document.getElementById('connectionStatus').textContent = 'Connection Error';
        statusDot.style.background = '#ef4444'; // Red
        logActivity('System', 'WebSocket connection error', true);
    };
}

// ===== MESSAGE HANDLING (Unchanged) =====
function handleMessage(data) {
    switch (data.type) {
        case 'status_update':
            updateSystemStatus(data);
            break;

        case 'user_status':
            updateUserStatus(data.client_id, data.status, data.name);
            logActivity('User Status', `${data.name || data.client_id.replace('client_', 'Client-')} reported: ${data.status}`);
            break;

        case 'fire_alert':
            const sensor_id = data.alert_data ? data.alert_data.sensor_id : 'Manual Trigger';
            const smoke_level = data.alert_data ? data.alert_data.smoke_level : 'N/A';

            logActivity('FIRE ALERT',
                `Sensor ${sensor_id} detected fire (Level: ${smoke_level})`,
                true);

            showFireAlert();
            break;

        case 'new_user_message':
            logActivity('Quick Panel', `${data.data.sensor_id}: ${data.data.message}`, true);
            break;
    }
}

// ===== SYSTEM STATUS UPDATES (Unchanged) =====
function updateSystemStatus(data) {
    document.getElementById('clientCount').textContent = data.connected_clients || 0;

    if (data.alert_active) {
        showFireAlert();
    } else {
        const alertStatusBox = document.getElementById('alertStatusBox');
        document.getElementById('alertBanner').classList.remove('active');
        document.getElementById('alertStatus').textContent = 'Normal';
        alertStatusBox.classList.remove('alert');
        document.querySelector('.status-dot').classList.remove('active');
    }

    document.getElementById('userStatusList').innerHTML = '';
    if (data.user_status && Object.keys(data.user_status).length > 0) {
        Object.entries(data.user_status).forEach(([clientId, statusData]) => {
            updateUserStatus(clientId, statusData.status, statusData.name);
        });
    } else {
        document.getElementById('userStatusList').innerHTML = '<p style="color: #9ca3af; text-align: center; padding: 20px;">No status reports yet. Waiting for user updates...</p>';
    }
}

function showFireAlert() {
    const alertBanner = document.getElementById('alertBanner');
    const alertStatusText = document.getElementById('alertStatus');
    const alertStatusBox = document.getElementById('alertStatusBox');
    const statusDot = document.querySelector('.status-dot');

    alertBanner.classList.add('active');
    alertStatusText.textContent = '🚨 ALERT ACTIVE';
    alertStatusBox.classList.add('alert');
    statusDot.classList.add('active');

    document.getElementById('activityLog').scrollTop = 0;
}

function updateUserStatus(clientId, status, name = null) {
    const listElement = document.getElementById('userStatusList');

    let userItem = document.getElementById(`user-${clientId}`);

    if (!userItem) {
        userItem = document.createElement('div');
        userItem.id = `user-${clientId}`;
        listElement.prepend(userItem);
    }

    const statusConfig = {
        'SAFE': { emoji: '✅', text: 'Safe', color: '#10b981' },
        'NEED_HELP': { emoji: '⚠️', text: 'Needs Help', color: '#ef4444' },
        'INJURED': { emoji: '🩹', text: 'Injured', color: '#f59e0b' },
        'TRAPPED': { emoji: '🚪', text: 'Trapped', color: '#8b5cf6' }
    };

    const config = statusConfig[status] || { emoji: '❓', text: 'Unknown', color: '#9ca3af' };

    const displayName = name || clientId.replace('client_', 'Client-');

    userItem.className = `user-status-item ${status.toLowerCase().replace('_', '-')}`;

    userItem.innerHTML = `
        <span class="user-id">${displayName}</span>
        <span class="user-status" style="color: ${config.color}">${config.emoji} ${config.text}</span>
    `;
}

// ===== EMERGENCY CONTROLS  =====
function triggerAlarm() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('❌ Not connected to server. Please wait...');
        logActivity('System Error', 'Attempted to trigger alarm while disconnected', true);
        return;
    }

    if (confirm('⚠️ Are you sure you want to trigger the fire alarm manually?\n\nThis will alert all connected users immediately.')) {
        ws.send(JSON.stringify({ type: 'trigger_alarm' }));

        showFireAlert();
        logActivity('Admin Action', 'Manual fire alarm triggered', true);
        alert('✅ Fire alarm has been triggered successfully!');
    }
}

function sendSafetyInstructions() {
    const safetyMessage = `⚠️ SAFETY INSTRUCTIONS: Evacuate immediately via the nearest safe stairwell. Do NOT use elevators. Proceed to assembly point at main parking lot.`;
    document.getElementById('broadcastMessage').value = safetyMessage;
    broadcastMessage();
}

function sendAllClear() {
    if (confirm('✅ Send ALL CLEAR signal to users?\n\nThis indicates the emergency is over and it is safe.')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'clear_alarm' }));
        }

        const alertStatusBox = document.getElementById('alertStatusBox');
        document.getElementById('alertBanner').classList.remove('active');
        document.getElementById('alertStatus').textContent = 'Normal';
        alertStatusBox.classList.remove('alert');
        document.querySelector('.status-dot').classList.remove('active');

        logActivity('Admin Action', 'All Clear signal sent & Alert cleared');
    }
}

// ===== BROADCAST MESSAGE & MAP LOGIC (Modified for Validation) =====

function setQuickMessage(message) {
    document.getElementById('broadcastMessage').value = message;
}

function broadcastMessage() {
    const message = document.getElementById('broadcastMessage').value.trim();

    if (!message) {
        alert('❌ Please enter a message to broadcast.');
        return;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        let payload = {
            type: 'broadcast',
            message: message
        };

        if (selectedMapFile) {
            sendEvacuationMap(message);
            return;
        }

        ws.send(JSON.stringify(payload));

        logActivity('Broadcast', `Message sent: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
        document.getElementById('broadcastMessage').value = '';
    } else {
        alert('❌ Not connected to server.');
    }
}

function previewMap(event) {
    const file = event.target.files[0];
    if (!file) return;

    // 🎯 NEW VALIDATION CHECK 🎯
    if (!APPROVED_MAP_FILENAMES.includes(file.name)) {
        alert('❌ ERROR: This map image is not on the approved list of evacuation plans. Only pre-verified images can be sent.');
        event.target.value = ''; // Clear the input field
        document.getElementById('sendMapBtn').disabled = true;
        document.getElementById('mapPreview').classList.remove('active');
        return;
    }

    selectedMapFile = file;
    const reader = new FileReader();

    reader.onload = function (e) {
        document.getElementById('mapImage').src = e.target.result;
        document.getElementById('mapPreview').classList.add('active');
        document.getElementById('sendMapBtn').disabled = false;
    };
    reader.readAsDataURL(file);
    logActivity('Map Upload', `Evacuation map loaded: ${file.name}`);
}

function sendEvacuationMap(textMessage) {
    if (!selectedMapFile) {
        alert('❌ Please select an evacuation map first.');
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        const mapData = e.target.result;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'broadcast',
                message: textMessage || '🗺️ EVACUATION MAP SENT - Please check your screen for the latest floor plan.',
                map_data: mapData,
                map_filename: selectedMapFile.name
            }));

            logActivity('Admin Action', `Evacuation map sent (${selectedMapFile.name})`);
            alert('✅ Evacuation map sent to all connected users!');

            document.getElementById('mapInput').value = '';
            document.getElementById('sendMapBtn').disabled = true;
            document.getElementById('mapPreview').classList.remove('active');
            selectedMapFile = null;
        } else {
            alert('❌ Not connected to server.');
        }
    };
    reader.readAsDataURL(selectedMapFile);
}


// ===== ACTIVITY LOG (Unchanged) =====
function logActivity(category, message, isAlert = false) {
    const logElement = document.getElementById('activityLog');

    const emptyMessage = logElement.querySelector('p[style*="color: #9ca3af"]');
    if (emptyMessage) {
        logElement.innerHTML = '';
    }

    const logDiv = document.createElement('div');
    logDiv.className = 'log-message';
    if (isAlert) {
        logDiv.style.borderLeftColor = '#ef4444';
        logDiv.style.background = '#fef2f2';
    }

    const timestamp = new Date().toLocaleTimeString();
    logDiv.innerHTML = `
        <div class="timestamp">${timestamp} - ${category}</div>
        <div class="text">${message}</div>
    `;

    logElement.insertBefore(logDiv, logElement.firstChild);

    while (logElement.children.length > 50) {
        logElement.removeChild(logElement.lastChild);
    }
}