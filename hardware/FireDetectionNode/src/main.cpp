#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <ArduinoJson.h> // 👈 NEW: Include the JSON library

// --- Network Configuration (Recommended Static IP) ---
const char* ssid = "FireEmergency_LAN";   // Your hotspot name
const char* password = "emergency123";    // Your hotspot password

// Recommended: Static IP Configuration (Optional but improves reliability)
IPAddress local_IP(192, 168, 1, 101);  // Unique IP for this sensor node
IPAddress gateway(192, 168, 1, 1);     // Your router/gateway IP
IPAddress subnet(255, 255, 255, 0);    // Standard subnet mask

// --- Sensor Configuration ---
#define MQ2_PIN A0                     // MQ-2 connected to analog pin A0
#define SMOKE_THRESHOLD 400            // Adjust based on sensor calibration

// --- UDP Configuration ---
WiFiUDP udp;
const char* broadcast_ip = "255.255.255.255"; // Broadcast to all devices
const int udp_port = 5005;

// --- Alert State ---
bool alertSent = false;
unsigned long lastAlertTime = 0;
const unsigned long ALERT_INTERVAL = 5000;    // Send alert every 5 seconds
const char* NODE_ID = "ROOM_301_SENSOR";      // 👈 Recommended: Use a fixed ID

void sendFireAlert(int smokeLevel);

// Function Prototype
void sendFireAlert(int smokeLevel);

void setup() {
  Serial.begin(115200);
  pinMode(MQ2_PIN, INPUT);
  
  Serial.println("\n\n=== Fire Emergency Detection System ===");
  
  // Connect to WiFi hotspot with Static IP
  WiFi.mode(WIFI_STA);
  if (!WiFi.config(local_IP, gateway, subnet)) {
    Serial.println("Static IP Configuration Failed! Using DHCP.");
  }
  
  WiFi.begin(ssid, password);
  
  Serial.print("Connecting to ");
  Serial.print(ssid);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\n✓ WiFi Connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
  
  // Start UDP
  udp.begin(udp_port);
  Serial.println("✓ UDP Broadcast Ready");
  Serial.print("Node ID: ");
  Serial.println(NODE_ID);
  Serial.println("System Armed - Monitoring for smoke...\n");
}

void loop() {
  // Read smoke sensor value
  int smokeLevel = analogRead(MQ2_PIN);
  
  // Display readings every 2 seconds (non-blocking)
  static unsigned long lastPrint = 0;
  if (millis() - lastPrint > 2000) {
    Serial.print("Smoke Level: ");
    Serial.print(smokeLevel);
    Serial.println(smokeLevel > SMOKE_THRESHOLD ? " [DANGER!]" : " [Normal]");
    lastPrint = millis();
  }
  
  // Check for fire condition
  if (smokeLevel > SMOKE_THRESHOLD) {
    // Send alert if enough time has passed since last alert (non-blocking)
    if (millis() - lastAlertTime > ALERT_INTERVAL) {
      sendFireAlert(smokeLevel);
      lastAlertTime = millis();
      alertSent = true;
    }
  } else {
    // Reset alert state when smoke clears
    if (alertSent) {
      Serial.println("✓ Smoke cleared - System normal");
      alertSent = false;
    }
  }
  
  delay(100);
}

// --- UPDATED Function to Broadcast Alert using ArduinoJson ---
void sendFireAlert(int smokeLevel) {
  // Define the memory size needed for the JSON object (5 keys)
  const size_t capacity = JSON_OBJECT_SIZE(5);
  StaticJsonDocument<capacity> doc;

  // Build the JSON alert message
  doc["type"]        = "FIRE_ALERT";
  doc["smoke_level"] = smokeLevel;
  doc["threshold"]   = SMOKE_THRESHOLD;
  doc["sensor_id"]   = NODE_ID; 
  doc["ip"]          = WiFi.localIP().toString();
  
  // Serialize the JSON object to a String
  String output;
  serializeJson(doc, output);
  
  // Broadcast UDP packet
  udp.beginPacket(broadcast_ip, udp_port);
  udp.write(output.c_str());
  udp.endPacket();
  
  Serial.println("\n🚨 FIRE ALERT BROADCASTED 🚨");
  Serial.print("Message: ");
  Serial.println(output);
  Serial.println();
}