// admin.js

let ws = null;
let authToken = null;
let selectedMapFile = null;
const SERVER_URL = `ws://${window.location.hostname}:8080`;
const HTTP_API_URL = `http://${window.location.hostname}:8080/api/admin`;

// ===== AUTHENTICATION =====
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

// ===== WEBSOCKET CONNECTION =====
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

// ===== MESSAGE HANDLING (CRITICAL FOR UPDATING UI) =====
function handleMessage(data) {
    switch(data.type) {
        case 'status_update':
            // Initial status update upon connection (includes alert_active state)
            updateSystemStatus(data);
            break;

        case 'user_status':
            // Real-time status update from a client (e.g., "TRAPPED")
            updateUserStatus(data.client_id, data.status);
            logActivity('User Status', `${data.client_id.replace('client_', 'Client-')} reported: ${data.status}`);
            break;

        case 'fire_alert':
            // Alert triggered by ESP8266 (via UDP) or Manual Trigger (WS)
            
            // Log the alert data using sensor details if available
            const sensor_id = data.alert_data ? data.alert_data.sensor_id : 'Manual Trigger';
            const smoke_level = data.alert_data ? data.alert_data.smoke_level : 'N/A';
            
            logActivity('FIRE ALERT', 
                         `Sensor ${sensor_id} detected fire (Level: ${smoke_level})`, 
                         true);
            
            // Call the visual update function
            showFireAlert(); 
            break;
            
        case 'new_user_message':
            // Message from physical Quick Response Terminal (via UDP -> Server -> WS)
            logActivity('Quick Panel', `${data.data.sensor_id}: ${data.data.message}`, true);
            break;
    }
}

// ===== SYSTEM STATUS UPDATES =====
function updateSystemStatus(data) {
    document.getElementById('clientCount').textContent = data.connected_clients || 0;
    
    // Check global alert state from the server
    if (data.alert_active) {
        showFireAlert(); 
    } else {
        // If system is normal, ensure the UI reflects it
        const alertStatusBox = document.getElementById('alertStatusBox');
        document.getElementById('alertBanner').classList.remove('active');
        document.getElementById('alertStatus').textContent = 'Normal';
        alertStatusBox.classList.remove('alert');
        document.querySelector('.status-dot').classList.remove('active');
    }
    
    // Update User Status List
    document.getElementById('userStatusList').innerHTML = ''; // Clear list
    if (data.user_status && Object.keys(data.user_status).length > 0) {
        Object.entries(data.user_status).forEach(([clientId, statusData]) => {
            updateUserStatus(clientId, statusData.status);
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
    
    // 💡 Visual Updates
    alertBanner.classList.add('active'); // Shows the red banner
    alertStatusText.textContent = '🚨 ALERT ACTIVE'; 
    alertStatusBox.classList.add('alert'); // Adds red styling to stat box
    statusDot.classList.add('active'); // Start blinking connection dot
    
    document.getElementById('activityLog').scrollTop = 0;
}

function updateUserStatus(clientId, status) {
    const listElement = document.getElementById('userStatusList');
    
    let userItem = document.getElementById(`user-${clientId}`);
    
    if (!userItem) {
        userItem = document.createElement('div');
        userItem.id = `user-${clientId}`;
        listElement.prepend(userItem); // Add new users to the top
    }

    const statusConfig = {
        'SAFE': { emoji: '✅', text: 'Safe', color: '#10b981' },
        'NEED_HELP': { emoji: '⚠️', text: 'Needs Help', color: '#ef4444' },
        'INJURED': { emoji: '🩹', text: 'Injured', color: '#f59e0b' },
        'TRAPPED': { emoji: '🚪', text: 'Trapped', color: '#8b5cf6' }
    };

    const config = statusConfig[status] || { emoji: '❓', text: 'Unknown', color: '#9ca3af' };

    userItem.className = `user-status-item ${status.toLowerCase().replace('_', '-')}`;
    
    userItem.innerHTML = `
        <span class="user-id">${clientId.replace('client_', 'Client-')}</span>
        <span class="user-status" style="color: ${config.color}">${config.emoji} ${config.text}</span>
    `;
}

// ===== EMERGENCY CONTROLS =====
function triggerAlarm() {
    if (confirm('⚠️ Are you sure you want to trigger the fire alarm manually?\n\nThis will alert all connected users immediately.')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'trigger_alarm' }));
            showFireAlert(); // Update UI immediately
            logActivity('Admin Action', 'Manual fire alarm triggered', true);
            alert('✅ Fire alarm has been triggered successfully!');
        } else {
            alert('❌ Not connected to server.');
        }
    }
}

function sendSafetyInstructions() {
    const safetyMessage = `⚠️ SAFETY INSTRUCTIONS: Evacuate immediately via the nearest safe stairwell. Do NOT use elevators. Proceed to assembly point at main parking lot.`;
    document.getElementById('broadcastMessage').value = safetyMessage;
    broadcastMessage();
}

function sendAllClear() {
    if (confirm('✅ Send ALL CLEAR signal to users?\n\nThis indicates the emergency is over and it is safe.')) {
        // 1. Send ALL CLEAR Broadcast
        const message = '✅ ALL CLEAR: Fire has been contained and extinguished. It is now safe. Please remain at assembly points for headcount and further instructions.';
        document.getElementById('broadcastMessage').value = message;
        broadcastMessage();
        
        // 2. Clear Alert State in UI
        const alertStatusBox = document.getElementById('alertStatusBox');
        document.getElementById('alertBanner').classList.remove('active');
        document.getElementById('alertStatus').textContent = 'Normal';
        alertStatusBox.classList.remove('alert');
        document.querySelector('.status-dot').classList.remove('active');
        
        logActivity('Admin Action', 'All Clear signal sent & Alert cleared');
    }
}

// ===== BROADCAST MESSAGE & MAP LOGIC =====
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
        // Check if there is a map file selected to include in the broadcast
        let payload = {
            type: 'broadcast',
            message: message
        };
        
        if (selectedMapFile) {
            // Map logic is already handled in the map submission function
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

// ===== EVACUATION MAP =====
function previewMap(event) {
    const file = event.target.files[0];
    if (!file) return;

    selectedMapFile = file;
    const reader = new FileReader();

    reader.onload = function(e) {
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
    reader.onload = function(e) {
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
            
            // Clear map selection after sending
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


// ===== ACTIVITY LOG =====
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

// Initial login screen display on page load
// The user must manually click 'Login' to connect the WebSocket