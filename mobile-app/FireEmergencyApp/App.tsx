// App.tsx - FINAL COMPLETE CODE WITH FCM TOKEN REGISTRATION

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  View, 
  Text, 
  Alert, 
  StyleSheet, 
  TouchableOpacity,
  Modal, 
  TextInput, 
  Button,
  AppState,
  Image,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import Sound from 'react-native-sound'; 
import messaging from '@react-native-firebase/messaging'; // FCM Library

// --- CONFIGURATION ---
const SERVER_IP = '10.230.229.152';
const WS_URL = `ws://${SERVER_IP}:8080/ws/client`;

// --- GLOBAL SOUND HELPER (for Foreground Use) ---
Sound.setCategory('Playback', true); 
const alarmSound = new Sound('alarm.mp3', Sound.MAIN_BUNDLE, (error) => {
    if (error) {
        console.log('Failed to load the alarm sound:', error);
        return;
    }
    alarmSound.setNumberOfLoops(-1);
    alarmSound.setVolume(1.0);
});

const startSiren = () => {
    if (alarmSound && !alarmSound.isPlaying()) {
        alarmSound.play((success) => {
            if (!success) {
                console.log('Alarm playback failed.');
                alarmSound.reset();
            }
        });
    }
};

const stopSiren = () => {
    if (alarmSound && alarmSound.isPlaying()) {
        alarmSound.stop(() => {
            console.log("Alarm stopped successfully.");
        });
    }
};
// --- END GLOBAL SOUND HELPER ---


function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('AWAITING_NAME');
  const [isAlertActive, setIsAlertActive] = useState(false);
  const [alertMessage, setAlertMessage] = useState('Awaiting instructions...');
  
  const [userName, setUserName] = useState('');
  const [fcmToken, setFcmToken] = useState(null); 
  const [isNameModalVisible, setIsNameModalVisible] = useState(true);

  const [mapBase64, setMapBase64] = useState(null);
  const [mapFileName, setMapFileName] = useState(null);

  const ws = useRef(null); 
  const appState = useRef(AppState.currentState);

  // === 1. GET FCM TOKEN & PERMISSIONS ===
  const getFcmTokenAndPermissions = async () => {
    try {
        // Request permission for notifications 
        const authStatus = await messaging().requestPermission();
        const enabled =
            authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
            authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (enabled) {
            const token = await messaging().getToken();
            setFcmToken(token); // Save token to state
        } else {
            Alert.alert('Permission Denied', 'You will not receive background alerts without notification permission.');
        }
    } catch (error) {
        console.error('Error getting FCM token:', error);
    }
  };
  
  // === 2. CONNECTION LOGIC (Runs when in foreground) ===
  const connectWebSocket = useCallback(() => {
    if (ws.current) {
      ws.current.close();
    }
    
    ws.current = new WebSocket(WS_URL);
    
    ws.current.onopen = () => {
      setIsConnected(true);
      setCurrentStatus('CONNECTED');
      
      // CRITICAL: Send name AND FCM token to server
      if (userName && fcmToken) {
          ws.current.send(JSON.stringify({ 
            type: 'register_name', 
            name: userName,
            fcm_token: fcmToken // Send token
          }));
      }
    };

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (e) {
        console.error("Error parsing message:", e);
      }
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
      setCurrentStatus('ERROR');
    };

    ws.current.onclose = () => {
      setIsConnected(false);
      if (userName) {
          setTimeout(connectWebSocket, 3000); 
      }
    };
  }, [userName, fcmToken]); 

  // === 3. APP STATE and INITIAL CONNECTION EFFECT ===
  useEffect(() => {
    // A. Handle App State Changes
    const handleAppStateChange = async (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        const state = await NetInfo.fetch();
        if (state.isConnected) {
            connectWebSocket(); // Reconnect WS when coming back to foreground
        } else {
            setCurrentStatus('NO INTERNET');
        }
      }
      appState.current = nextAppState;
    };
    
    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    // B. Initial Connection (After name modal)
    if (!isNameModalVisible && userName) {
        if (!fcmToken) {
            getFcmTokenAndPermissions(); // Get token first
        } else {
            connectWebSocket(); // Then connect
        }
    }
    
    // C. Foreground Message Listener (Handles FCM *if app is open*)
    const unsubscribe = messaging().onMessage(async remoteMessage => {
        const { type, message } = remoteMessage.data;
        
        if (type === 'fire_alert') {
            setIsAlertActive(true);
            setMapBase64(null);
            setAlertMessage(message || 'FIRE DETECTED!');
            startSiren();
            Alert.alert('🚨 FCM ALERT', message);
        } else if (type === 'clear_alert') {
            setIsAlertActive(false);
            setMapBase64(null);
            setAlertMessage('Alert cleared. Proceed with caution.');
            stopSiren();
            Alert.alert('✅ FCM ALL CLEAR', message);
        }
    });

    // D. Cleanup
    return () => {
      appStateSubscription.remove(); 
      unsubscribe(); 
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [isNameModalVisible, userName, fcmToken, connectWebSocket]); 


  // === 4. MESSAGE HANDLING (for WebSocket messages) ===
  const handleMessage = (data) => {
    switch(data.type) {
      case 'fire_alert':
        if (isAlertActive) return; // Ignore if already active from FCM
        setIsAlertActive(true);
        setMapBase64(null); 
        setAlertMessage(data.message || 'FIRE DETECTED! EVACUATE IMMEDIATELY');
        startSiren(); 
        Alert.alert('🚨 WS ALERT', data.message); // Show WS alert type
        break;

      case 'clear_alert':
        if (!isAlertActive) return;
        setIsAlertActive(false);
        setMapBase64(null); 
        setAlertMessage('Alert cleared. Proceed with caution.');
        stopSiren(); 
        Alert.alert('✅ WS ALL CLEAR', data.message);
        break;
        
      case 'broadcast':
        if (data.map_data) {
            setMapBase64(data.map_data); 
            setMapFileName(data.map_filename);
            Alert.alert('🗺️ Map Received', data.message);
        } else {
            Alert.alert('📢 Admin Broadcast', data.message);
        }
        break;
    }
  };

  // === 5. SEND STATUS & MUTE LOGIC ===
  const sendStatus = (status) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'status_update', status: status }));
      
      const statusMessages = {
        'SAFE': '✓ Status: SAFE', 'NEED_HELP': '⚠️ Status: NEED HELP', 
        'INJURED': '🩹 Status: Injured', 'TRAPPED': '🚪 Status: Trapped'
      };
      setCurrentStatus(statusMessages[status]);
      Alert.alert('Status Sent', `You reported: ${statusMessages[status]}`);
    } else {
      Alert.alert('Connection Error', 'Not connected to server. Please wait.');
    }
  };

  const muteLocalAlarm = () => {
    stopSiren(); 
    setIsAlertActive(false);
    setAlertMessage('Alarm Muted. Awaiting final instructions.');
    Alert.alert('Alarm Muted', 'The local siren has been silenced. Global emergency is still active.');
  };

  const handleNameRegistration = () => {
    if (userName.length < 2) {
      Alert.alert('Required', 'Please enter your name to start.');
      return;
    }
    // Get token *before* closing modal
    getFcmTokenAndPermissions(); 
    setIsNameModalVisible(false);
  };
  
  // === 6. RENDER (Unchanged) ===
  return (
    <View style={styles.container}>
      
      {/* NAME REGISTRATION MODAL */}
      <Modal 
        animationType="slide"
        transparent={true}
        visible={isNameModalVisible}
        onRequestClose={() => { /* Prevent closing */ }}
      >
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <Text style={styles.modalText}>Welcome to the Emergency App</Text>
            <Text style={styles.modalSubText}>Please enter your name for identification:</Text>
            <TextInput
              style={styles.input}
              onChangeText={setUserName}
              value={userName}
              placeholder="Your Full Name"
              placeholderTextColor="#999"
            />
            <Button
              title="Start Tracking"
              onPress={handleNameRegistration}
              color="#3b82f6"
            />
          </View>
        </View>
      </Modal>

      {/* MAIN APP UI */}
      <Text style={isAlertActive ? styles.alertTitle : styles.title}>
        {isAlertActive ? '🚨 FIRE EMERGENCY 🚨' : 'Fire Emergency App'}
      </Text>
      
      <Text style={styles.statusText}>
        {isConnected ? `Connected as: ${userName}` : 'Disconnected - Reconnecting...'}
      </Text>
      
      {isAlertActive && (
        <>
            <View style={styles.alertBox}>
              <Text style={styles.alertMessage}>{alertMessage}</Text>
            </View>
            <View style={styles.muteButtonContainer}>
                <Button
                    title="🔇 MUTE LOCAL SIREN"
                    onPress={muteLocalAlarm}
                    color="#95a5a6" 
                />
            </View>
        </>
      )}
      
      {mapBase64 && (
        <View style={styles.mapContainer}>
          <Text style={styles.mapTitle}>🗺️ Evacuation Map: {mapFileName}</Text>
          <Image
            style={styles.mapImage}
            source={{ uri: mapBase64 }}
            resizeMode="contain"
          />
        </View>
      )}

      <View style={styles.buttonGrid}>
        <StatusButton status="SAFE" label="I'm Safe" color="#2ecc71" onPress={sendStatus} />
        <StatusButton status="NEED_HELP" label="Need Help" color="#e74c3c" onPress={sendStatus} />
        <StatusButton status="INJURED" label="Injured" color="#f39c12" onPress={sendStatus} />
        <StatusButton status="TRAPPED" label="Trapped" color="#9b59b6" onPress={sendStatus} />
      </View>
      
      <Text style={styles.currentStatus}>
        My Current Report: {currentStatus}
      </Text>
    </View>
  );
}

const StatusButton = ({ status, label, color, onPress }) => (
  <TouchableOpacity 
    style={[styles.statusButton, { backgroundColor: color }]}
    onPress={() => onPress(status)}
  >
    <Text style={styles.buttonText}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, padding: 30, backgroundColor: '#f0f3f6', alignItems: 'center' },
  title: { fontSize: 26, fontWeight: '600', color: '#2c3e50', marginBottom: 20 },
  alertTitle: { fontSize: 28, fontWeight: 'bold', color: '#e74c3c', marginBottom: 10 },
  statusText: { fontSize: 14, color: '#7f8c8d', marginBottom: 40 },
  alertBox: { backgroundColor: '#ffe6e6', borderWidth: 2, borderColor: '#e74c3c', borderRadius: 10, padding: 20, marginBottom: 30, width: '100%' },
  alertMessage: { color: '#c0392b', fontSize: 18, textAlign: 'center', fontWeight: 'bold' },
  mapContainer: { width: '100%', padding: 15, backgroundColor: '#fff', borderRadius: 10, marginBottom: 20, borderWidth: 1, borderColor: '#ccc' },
  mapTitle: { fontSize: 16, fontWeight: 'bold', color: '#34495e', marginBottom: 10, textAlign: 'center' },
  mapImage: { width: '100%', height: 250, borderRadius: 8 }, 
  buttonGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', width: '100%', marginBottom: 30 },
  statusButton: { width: '48%', padding: 15, borderRadius: 10, alignItems: 'center', marginBottom: 15, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 4 },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  currentStatus: { fontSize: 16, color: '#34495e', marginTop: 20 },
  muteButtonContainer: { width: '100%', marginBottom: 20 },
  centeredView: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalView: { margin: 20, backgroundColor: 'white', borderRadius: 20, padding: 35, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5, width: '80%' },
  modalText: { marginBottom: 15, textAlign: 'center', fontSize: 20, fontWeight: 'bold', color: '#2c3e50' },
  modalSubText: { marginBottom: 20, textAlign: 'center', fontSize: 14, color: '#7f8c8d' },
  input: { height: 50, borderColor: '#ccc', borderWidth: 1, marginBottom: 20, paddingHorizontal: 15, width: '100%', borderRadius: 10, color: '#333' }
});

export default App;