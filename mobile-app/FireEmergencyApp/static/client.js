// client.js

let ws = null;
let clientId = null;
const SERVER_URL = `ws://${window.location.host}`; 

// Connect to WebSocket server
function connect() {
    ws = new WebSocket(`${SERVER_URL}/ws/client`);
    
    ws.onopen = () => {
        console.log('Connected to server');
        updateStatus(true);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus(false);
    };

    ws.onclose = () => {
        console.log('Disconnected from server');
        updateStatus(false);
        // Attempt to reconnect after 3 seconds
        setTimeout(connect, 3000);
    };
}

function updateStatus(connected) {
    const badge = document.getElementById('statusBadge');
    if (connected) {
        badge.textContent = 'Connected';
        badge.className = 'status-badge status-connected';
    } else {
        badge.textContent = 'Disconnected';
        badge.className = 'status-badge status-disconnected';
    }
}

function handleMessage(data) {
    console.log('Received:', data);

    switch(data.type) {
        case 'connected':
            clientId = data.client_id;
            addMessage('System', `Connected with ID: ${clientId}`, false);
            break;

        case 'fire_alert':
            showFireAlert(data.message);
            playAlarm();
            addMessage('ALERT', data.message, true);
            // Hide map when fire alert first triggers
            hideEvacuationMap(); 
            break;

        case 'admin_message':
            addMessage('Admin', data.message, true);
            break;
            
        case 'clear_alert':
            // If the server sends a message to clear the alarm
            hideFireAlert();
            stopAlarm();
            hideEvacuationMap(); // Clear map on ALL CLEAR
            addMessage('System', 'Alert cleared by Admin. Proceed with caution.', false);
            break;
            
        case 'broadcast':
            // 🚨 NEW: Handle map data included in a general broadcast message
            if (data.map_data) {
                showEvacuationMap(data.map_data);
                addMessage('Admin Map', `Evacuation Map Sent: ${data.map_filename || 'Floor Plan'}`, true);
            } else {
                 // Regular text broadcast
                 addMessage('Admin', data.message, true);
            }
            break;
    }
}

function showFireAlert(message) {
    const alertBox = document.getElementById('alertBox');
    const alertMessage = document.getElementById('alertMessage');
    alertMessage.textContent = message;
    alertBox.classList.add('active');
}

function hideFireAlert() {
    document.getElementById('alertBox').classList.remove('active');
}

// 🗺️ NEW: Function to display the map
function showEvacuationMap(mapData) {
    const mapContainer = document.getElementById('evacuationMapContainer');
    const mapImage = document.getElementById('mapImage');
    
    // Set the base64 string as the image source
    mapImage.src = mapData; 
    mapContainer.classList.add('active');
}

function hideEvacuationMap() {
    document.getElementById('evacuationMapContainer').classList.remove('active');
    document.getElementById('mapImage').src = ''; // Clear image source
}


function playAlarm() {
    const audio = document.getElementById('alarmSound');
    audio.play().catch(e => console.warn('Audio play failed (User interaction needed):', e));
}

function stopAlarm() {
    const audio = document.getElementById('alarmSound');
    audio.pause();
    audio.currentTime = 0; // Rewind to the start
}

// Function triggered by the Quick Response Panel buttons
function sendStatus(status) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'status_update',
            status: status
        }));
        
        const statusMessages = {
            'SAFE': '✓ You reported: I am safe',
            'NEED_HELP': '⚠ You reported: Need help',
            'INJURED': '🩹 You reported: I am injured',
            'TRAPPED': '🚪 You reported: I am trapped'
        };
        
        addMessage('You', statusMessages[status], false);
    } else {
        alert('Not connected to server. Please wait...');
    }
}

function addMessage(sender, text, isAlert) {
    const messagesList = document.getElementById('messagesList');
    
    const emptyMessage = messagesList.querySelector('p[style*="color: #9ca3af"]');
    if (emptyMessage) {
        messagesList.innerHTML = '';
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = isAlert ? 'message admin' : 'message';
    
    const timestamp = new Date().toLocaleTimeString();
    messageDiv.innerHTML = `
        <div class="timestamp">${timestamp} - ${sender}</div>
        <div class="text">${text}</div>
    `;
    
    messagesList.insertBefore(messageDiv, messagesList.firstChild);
    messagesList.scrollTop = 0; 
}

// Connect on page load
connect();