🔥 Fire Emergency Communication System (IoT & Real-Time)

A comprehensive, full-stack emergency alerting system designed for Local Area Network (LAN) deployment. This system integrates physical hardware sensors with a centralized Python backend and real-time mobile/web client interfaces to ensure rapid evacuation and occupant tracking during fire incidents.

🏗️ System Architecture

The project consists of three integrated modules:

Hardware (Sensing Layer): NodeMCU (ESP8266) equipped with an MQ-2 Smoke Sensor. It monitors air quality and triggers an alert via HTTP POST to the server when smoke levels exceed a threshold.

Server (Central Hub): An asynchronous Python server built with aiohttp. It manages WebSocket connections, broadcasts real-time alerts, and integrates with Firebase Cloud Messaging (FCM) for high-priority mobile push notifications.

Client Interfaces:

Native Android App: Built with React Native, providing occupants with a siren alert (even in the background) and a status reporting panel (Safe/Trapped).

Admin Dashboard: A web-based command center for emergency responders to monitor user safety in real-time.

🗂️ Project Structure

LAN_FireAlertSystem/
├── hardware/               # ESP8266 / NodeMCU Firmware (C++/Arduino)
├── mobile-app/             # React Native Android Application
│   └── FireEmergencyApp/   # Root of the mobile project
├── server/                 # Python Backend
│   └── Server-Receiver/    # Core server logic & Web Dashboard
├── .gitignore              # Configured to exclude sensitive keys and build files
└── README.md               # Project documentation


🚀 Getting Started

1. Server Setup

Navigate to server/Server-Receiver/.

Ensure a valid serviceAccountKey.json from your Firebase Project is present (Locally only).

Install dependencies: pip install aiohttp firebase-admin aiohttp_cors.

Run the server: python server.py.

2. Mobile App Setup

Navigate to mobile-app/FireEmergencyApp/.

Update the SERVER_IP in App.tsx to match your laptop's local IP address.

Install dependencies: npm install.

Run the app: npx react-native run-android.

3. Hardware Setup

Open the hardware firmware in the Arduino IDE.

Update the Wi-Fi credentials and the ALERT_URL to point to your server.

Upload to your NodeMCU.

🛠️ Tech Stack

Languages: Python (Backend), TypeScript/JavaScript (Mobile), C++ (Hardware).

Frameworks: React Native, Aiohttp (Asynchronous Python).

Protocols: WebSockets (Real-time), HTTP REST (Hardware Trigger), UDP (Sensor Discovery).

Cloud Services: Firebase Cloud Messaging (FCM).

🛡️ Security Note

This repository uses .gitignore to prevent the accidental upload of sensitive Firebase credentials (serviceAccountKey.json). Users deploying this must provide their own service account keys.