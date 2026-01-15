import {AppRegistry, LogBox} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

// --- NEW FIREBASE/SOUND IMPORTS ---
import messaging from '@react-native-firebase/messaging';
import Sound from 'react-native-sound';
// ----------------------------------

// Suppress warnings
LogBox.ignoreLogs([
  'NOBRIDGE WARN This method is deprecated', 
  'No Firebase App',
]);

// --- BACKGROUND TASK FOR ALARM ---

// Initialize sound object for background use
// IMPORTANT: Sound object must be initialized outside of the component/task
Sound.setCategory('Playback', true); 
const backgroundAlarm = new Sound('alarm.mp3', Sound.MAIN_BUNDLE, (error) => {
    if (error) {
        console.log('[Background] Failed to load the alarm sound:', error);
        return;
    }
    console.log('[Background] Alarm sound loaded.');
    backgroundAlarm.setNumberOfLoops(-1);
    backgroundAlarm.setVolume(1.0);
});

// Register the background message handler
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    console.log('FCM Message handled in the background!', remoteMessage);
    
    const { type } = remoteMessage.data;
    
    if (type === 'fire_alert') {
        // Play the siren in the background
        console.log('[Background] FIRE_ALERT received. Playing siren...');
        if (backgroundAlarm && !backgroundAlarm.isPlaying()) {
            backgroundAlarm.play((success) => {
                if (!success) {
                    console.log('[Background] Playback failed.');
                    backgroundAlarm.reset();
                }
            });
        }
    } else if (type === 'clear_alert') {
        // Stop the siren in the background
        console.log('[Background] CLEAR_ALERT received. Stopping siren...');
        if (backgroundAlarm && backgroundAlarm.isPlaying()) {
            backgroundAlarm.stop();
        }
    }
});
// --- END BACKGROUND TASK ---


AppRegistry.registerComponent(appName, () => App);