import asyncio
import json
import socket
import threading
from datetime import datetime
from aiohttp import web 
import aiohttp_cors
import os
import hashlib # NEW: For generating stable, persistent IDs

# --- NEW FIREBASE IMPORTS ---
import firebase_admin
from firebase_admin import credentials, messaging

# Global state
clients = {}
admin_clients = {}
alert_active = False
user_status = {}
client_names = {} 
fcm_tokens = {} 
client_to_stable_id = {} # Maps transient client_id to the stable_id
# --- END NEW GLOBAL STATE ---

# --- FIREBASE INITIALIZATION ---
try:
    cred = credentials.Certificate('serviceAccountKey.json') 
    firebase_admin.initialize_app(cred)
    print("✓ Firebase Admin SDK initialized successfully.")
except FileNotFoundError:
    print("🔥 FATAL ERROR: 'serviceAccountKey.json' not found.")
    print("   Please download it from your Firebase project settings and place it here.")
    exit()
except Exception as e:
    print(f"🔥 FATAL ERROR: Failed to initialize Firebase Admin SDK: {e}")
    exit()
# --- END FIREBASE INITIALIZATION ---


# User credentials
ADMIN_CREDENTIALS = {
    "admin1": "admin123",
    "admin2": "admin456"
}

# 🎯 NEW: Function to generate a stable, persistent ID
def generate_stable_id(user_name, fcm_token):
    """Creates a deterministic, non-sequential ID based on user input and device token."""
    source_string = f"{user_name}:{fcm_token}"
    return hashlib.sha256(source_string.encode()).hexdigest()[:12]


class FireEmergencyServer:
    def __init__(self, udp_port=5006, http_port=8080):
        self.udp_port = udp_port
        self.http_port = http_port
        self.app = web.Application()
        self.main_loop = None 
        
        self.setup_routes()

    # ==========================================================
    # 1. ROUTE HANDLERS
    # ==========================================================

    async def client_websocket(self, request):
        """Handle client WebSocket connections (/ws/client)"""
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        
        # NOTE: This ID is transient (changes on every connection)
        transient_client_id = f"transient_{datetime.now().timestamp()}"
        clients[transient_client_id] = ws
        print(f"✓ Client connected: {transient_client_id} (Total connections: {len(clients)})")
        
        await ws.send_json({
            'type': 'connected',
            'client_id': transient_client_id, 
            'message': 'Connected to Fire Emergency System'
        })
        
        try:
            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    await self.handle_client_message(transient_client_id, data)
                elif msg.type == web.WSMsgType.ERROR:
                    print(f'WebSocket error: {ws.exception()}')
        finally:
            # 🎯 FIX: AGGRESSIVE CLEANUP using the STABLE ID
            stable_id = client_to_stable_id.pop(transient_client_id, None)

            if stable_id:
                # Remove status, name, and token tied to the stable ID
                user_status.pop(stable_id, None) 
                client_names.pop(stable_id, None)
                fcm_tokens.pop(stable_id, None)
            
            clients.pop(transient_client_id, None) 

            print(f"✗ Client disconnected: {transient_client_id} (Total active sockets: {len(clients)})")
            
            # Update Admin Dashboard after cleanup
            await self.broadcast_to_admins({
                'type': 'status_update',
                'connected_clients': len(clients), 
                'user_status': user_status # This now only contains stable IDs
            })
        
        return ws

    async def admin_websocket(self, request):
        """Handle admin WebSocket connections (/ws/admin)"""
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        
        admin_id = f"admin_{len(admin_clients) + 1}"
        admin_clients[admin_id] = ws
        print(f"✓ Admin connected: {admin_id}")
        
        await ws.send_json({
            'type': 'status_update',
            'alert_active': alert_active,
            'connected_clients': len(clients),
            'user_status': user_status
        })
        
        try:
            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    await self.handle_admin_message(admin_id, data)
                elif msg.type == web.WSMsgType.ERROR:
                    print(f'Admin WebSocket error: {ws.exception()}')
        finally:
            admin_clients.pop(admin_id, None)
            print(f"✗ Admin disconnected: {admin_id}")
        
        return ws

    async def admin_login(self, request):
        """Handle admin login (/api/admin/login)"""
        try:
            data = await request.json()
            username = data.get('username')
            password = data.get('password')
            
            if username in ADMIN_CREDENTIALS and ADMIN_CREDENTIALS[username] == password:
                return web.json_response({
                    'success': True,
                    'token': f'admin_{username}',
                    'message': 'Login successful'
                })
            else:
                return web.json_response({
                    'success': False,
                    'message': 'Invalid credentials'
                }, status=401)
        except Exception as e:
            return web.json_response({'error': str(e)}, status=400)
    
    async def admin_broadcast(self, request):
        """HTTP endpoint for admin broadcast (/api/admin/broadcast)"""
        try:
            data = await request.json()
            message = data.get('message')
            
            await self.broadcast_to_clients({
                'type': 'admin_message',
                'message': message,
                'from': data.get('token', 'Admin'), 
                'timestamp': datetime.now().isoformat()
            })
            
            return web.json_response({'success': True})
        except Exception as e:
            return web.json_response({'error': str(e)}, status=400)
    
    async def trigger_alarm_endpoint(self, request):
        """HTTP endpoint to trigger alarm (/api/admin/trigger_alarm)"""
        await self.trigger_alarm_manual()
        return web.json_response({'success': True, 'message': 'Alarm triggered'})
    
    async def clear_alarm_endpoint(self, request):
        """HTTP endpoint to clear alarm (/api/admin/clear_alarm)"""
        await self.clear_alarm()
        return web.json_response({'success': True, 'message': 'Alarm cleared'})
    
    async def get_status(self, request):
        """Get system status (/api/status)"""
        return web.json_response({
            'alert_active': alert_active,
            'connected_clients': len(clients),
            'connected_admins': len(admin_clients),
            'user_status': user_status
        })
    
    async def subscribe_pwa(self, request):
        """Handles PWA Push subscription data from clients"""
        # (Placeholder function, ignored for native app)
        return web.json_response({'success': True, 'message': 'Subscribed'})
    
    async def serve_client(self, request):
        raise web.HTTPFound('/static/client.html') 

    async def serve_admin(self, request):
        raise web.HTTPFound('/static/admin.html')
    
    async def serve_mobile(self, request):
        raise web.HTTPFound('/static/mobile.html')

    # ==========================================================
    # 2. SETUP ROUTES (Unchanged)
    # ==========================================================

    def setup_routes(self):
        """Setup HTTP and WebSocket routes"""
        
        self.app.router.add_get('/ws/client', self.client_websocket)
        self.app.router.add_get('/ws/admin', self.admin_websocket)
        
        self.app.router.add_post('/api/admin/login', self.admin_login)
        self.app.router.add_post('/api/admin/broadcast', self.admin_broadcast)
        self.app.router.add_post('/api/admin/trigger_alarm', self.trigger_alarm_endpoint)
        self.app.router.add_post('/api/admin/clear_alarm', self.clear_alarm_endpoint)
        self.app.router.add_get('/api/status', self.get_status)
        
        self.app.router.add_post('/api/subscribe', self.subscribe_pwa)
        
        self.app.router.add_static('/static/', path=os.path.join(os.path.dirname(__file__), 'static'), name='static')
        
        self.app.router.add_get('/', self.serve_client)
        self.app.router.add_get('/admin', self.serve_admin)
        self.app.router.add_get('/mobile', self.serve_mobile)
        
        cors = aiohttp_cors.setup(self.app, defaults={
            "*": aiohttp_cors.ResourceOptions(allow_credentials=True, expose_headers="*", allow_headers="*")
        })
        for route in list(self.app.router.routes()):
            cors.add(route)
            
    # ==========================================================
    # 3. UTILITY & LISTENER METHODS 
    # ==========================================================

    async def handle_client_message(self, transient_client_id, data):
        """Process messages from clients"""
        global fcm_tokens, client_names, user_status, client_to_stable_id
        msg_type = data.get('type')
        
        if msg_type == 'register_name':
            name = data.get('name')
            token = data.get('fcm_token')
            
            # 🎯 CRITICAL FIX: Generate stable ID
            stable_id = generate_stable_id(name, token)
            
            # Link the temporary socket ID to the stable user ID
            client_to_stable_id[transient_client_id] = stable_id
            
            # Store data under the stable ID
            client_names[stable_id] = name
            if token:
                fcm_tokens[stable_id] = token
            
            print(f"👤 Client registered. Name: {name}, Stable ID: {stable_id[:8]}...")
            
            # Update Admin Dashboard with the current list of *active* users
            await self.broadcast_to_admins({
                'type': 'status_update',
                'connected_clients': len(clients), 
                'user_status': user_status
            })

            
        elif msg_type == 'status_update': 
            status = data.get('status')
            
            # Use stable ID for persistence
            stable_id = client_to_stable_id.get(transient_client_id)
            if not stable_id:
                print(f"⚠️ ERROR: Status update from unregistered client {transient_client_id[:8]}")
                return
            
            display_name = client_names.get(stable_id, "Unknown User")
            
            user_status[stable_id] = {
                'status': status,
                'timestamp': datetime.now().isoformat(),
                'name': display_name # Use name for display
            }
            print(f"📊 Status update from {display_name}: {status}")
            
            await self.broadcast_to_admins({
                'type': 'user_status', 
                'client_id': stable_id, # Send stable ID as the key
                'status': status,
                'name': display_name,
                'timestamp': datetime.now().isoformat()
            })
    
    async def handle_admin_message(self, admin_id, data):
        """Process messages from admins"""
        msg_type = data.get('type')
        
        if msg_type == 'broadcast':
            message = data.get('message')
            map_data = data.get('map_data')
            map_filename = data.get('map_filename')
            
            await self.broadcast_to_clients({
                'type': 'broadcast', 
                'message': message,
                'from': admin_id,
                'timestamp': datetime.now().isoformat(),
                'map_data': map_data,        
                'map_filename': map_filename 
            })
            print(f"📢 Admin broadcast: {message} {'(Map attached)' if map_data else ''}")
            
        elif msg_type == 'trigger_alarm':
            await self.trigger_alarm_manual()
        
        elif msg_type == 'clear_alarm': 
            await self.clear_alarm()
            
    async def broadcast_to_clients(self, message):
        """Send message to all connected clients"""
        print(f"\n📤 Broadcasting to {len(clients)} client(s): {message.get('type')}")
        
        if len(clients) == 0:
            print("⚠️  WARNING: No clients connected to receive broadcast!")
            return
            
        disconnected = []
        success_count = 0
        
        for client_id, ws in clients.items():
            try:
                await ws.send_json(message)
                success_count += 1
            except Exception as e:
                print(f"   ✗ Failed to send to {client_id}: {e}")
                disconnected.append(client_id)
        
        for client_id in disconnected:
            clients.pop(client_id, None)
        
        print(f"✅ WebSocket Broadcast complete: {success_count}/{len(clients) + len(disconnected)} successful")
    
    async def broadcast_to_admins(self, message):
        """Send message to all connected admins"""
        disconnected = []
        for admin_id, ws in admin_clients.items():
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.append(admin_id)
        
        for admin_id in disconnected:
            admin_clients.pop(admin_id, None)

    async def send_fcm_push_notification(self, title, body, data_payload):
        """Sends a data-only push notification to all registered FCM tokens"""
        global fcm_tokens
        
        if not fcm_tokens:
             print("🔔 WARNING: No FCM tokens registered to receive push notifications.")
             return
             
        tokens = list(set(fcm_tokens.values()))
        
        print(f"🔔 Sending FCM Push to {len(tokens)} token(s)...")

        message = messaging.MulticastMessage(
            data=data_payload,
            tokens=tokens,
            android=messaging.AndroidConfig(
                priority="high"
            ),
            apns=messaging.APNSConfig(
                headers={"apns-priority": "10"}
            )
        )

        try:
            def send_fcm():
                return messaging.send_multicast(message)
            
            batch_response = await asyncio.to_thread(send_fcm)
            
            print(f"✅ FCM Push Sent: {batch_response.success_count} successful, {batch_response.failure_count} failed")
            
            if batch_response.failure_count > 0:
                failed_tokens = []
                for idx, response in enumerate(batch_response.responses):
                    if not response.success:
                        failed_tokens.append(tokens[idx])
                print(f"   Failed tokens: {failed_tokens}")
                
        except Exception as e:
            print(f"🔥 FCM Push ERROR: {e}")

    
    async def trigger_alarm_manual(self):
        """Manually trigger alarm (admin action)"""
        global alert_active
        alert_active = True
        
        print("🚨 Manual alarm triggered by admin")

        await self.broadcast_to_clients({
            'type': 'fire_alert',
            'source': 'manual_trigger',
            'message': 'FIRE EMERGENCY - EVACUATE IMMEDIATELY',
            'timestamp': datetime.now().isoformat()
        })
        
        await self.send_fcm_push_notification(
            title='🚨 FIRE ALERT',
            body='Evacuate immediately! Open the app for details.',
            data_payload={
                'type': 'fire_alert',
                'message': 'FIRE EMERGENCY - EVACUATE IMMEDIATELY'
            }
        )
    
    async def clear_alarm(self):
        """Clear the active alarm"""
        global alert_active
        alert_active = False
        
        print("✅ Alarm cleared - All clear message sent")
        
        await self.broadcast_to_clients({
            'type': 'clear_alert', 
            'message': '✅ ALL CLEAR - Emergency has been resolved.',
            'from': 'System',
            'timestamp': datetime.now().isoformat()
        })
        
        await self.send_fcm_push_notification(
            title='✅ ALL CLEAR',
            body='The emergency has been resolved. You may return to normal activities.',
            data_payload={
                'type': 'clear_alert'
            }
        )
        
        await self.broadcast_to_admins({
            'type': 'alert_cleared',
            'timestamp': datetime.now().isoformat()
        })
        

    async def notify_admin_of_user_message(self, alert_data):
        """Notify admins of a user message from a physical terminal"""
        await self.broadcast_to_admins({
             'type': 'new_user_message',
             'data': alert_data,
             'timestamp': datetime.now().isoformat()
        })

    async def handle_fire_alert(self, alert_data):
        """Handle fire alert from ESP8266 (or simulator)"""
        global alert_active
        
        if alert_active: 
            return 
            
        alert_active = True
        
        print(f"\n{'='*60}")
        print(f"🔥 PROCESSING FIRE ALERT")
        print(f"   Smoke Level: {alert_data.get('smoke_level')}")
        print(f"   Sensor ID: {alert_data.get('sensor_id')}")
        print(f"{'='*60}\n")
        
        broadcast_message = {
            'type': 'fire_alert',
            'source': 'esp8266_sensor',
            'message': '🚨 FIRE DETECTED - EVACUATE IMMEDIATELY 🚨',
            'timestamp': datetime.now().isoformat()
        }
        await self.broadcast_to_clients(broadcast_message)
        
        await self.broadcast_to_admins({
            'type': 'fire_alert',
            'alert_data': alert_data,
            'timestamp': datetime.now().isoformat()
        })
        
        await self.send_fcm_push_notification(
            title='🔥 FIRE DETECTED BY SENSOR',
            body=f"Evacuate Now! Smoke detected at {alert_data.get('sensor_id')}.",
            data_payload={
                'type': 'fire_alert',
                'message': 'FIRE DETECTED - EVACUATE IMMEDIATELY'
            }
        )
        
        print("✅ Fire alert processing complete!\n")

    def start_udp_listener(self):
        """Listens for UDP broadcasts from ESP8266"""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        
        try:
             sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        except OSError as e:
             print(f"Warning: Could not set SO_BROADCAST option: {e}") 

        sock.bind(('', self.udp_port))
        
        print(f"✓ UDP Listener started on port {self.udp_port}")
        print("Waiting for fire alerts from ESP8266...\n")
        
        loop = self.main_loop
        
        while True:
            try:
                data, addr = sock.recvfrom(1024)
                message = data.decode('utf-8')
                
                try:
                    alert_data = json.loads(message)
                    
                    if alert_data.get('type') == 'FIRE_ALERT' or alert_data.get('type') == 'USER_MESSAGE':
                        
                        coro = None
                        if alert_data.get('type') == 'FIRE_ALERT':
                            print(f"\n🚨 FIRE ALERT RECEIVED from {addr[0]}")
                            coro = self.handle_fire_alert(alert_data)
                        elif alert_data.get('type') == 'USER_MESSAGE':
                            print(f"\n🗣️ USER MESSAGE from {addr[0]}")
                            coro = self.notify_admin_of_user_message(alert_data)

                        if coro:
                            asyncio.run_coroutine_threadsafe(coro, loop)
                            print("   ✓ Alert processing scheduled successfully")

                except json.JSONDecodeError:
                    print(f"Invalid JSON from {addr[0]}: {message}")
                    
            except Exception as e:
                print(f"UDP Error: {e}")
    
    def run(self):
        """Start the server"""
        print("=" * 60)
        print("🔥 FIRE EMERGENCY COMMUNICATION SYSTEM 🔥")
        print("=" * 60)
        
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self.main_loop = loop
        
        print(f"✓ Event loop created: {self.main_loop}")
        
        udp_thread = threading.Thread(target=self.start_udp_listener, daemon=True)
        udp_thread.start()
        
        print(f"\n✓ HTTP Server starting on http://0.0.0.0:{self.http_port}")
        print(f"✓ Client Interface: http://localhost:{self.http_port}/")
        print(f"✓ Admin Interface: http://localhost:{self.http_port}/admin")
        print(f"✓ Mobile Interface: http://localhost:{self.http_port}/mobile")
        print("\nSystem ready! Waiting for connections...\n")
        
        web.run_app(self.app, host='0.0.0.0', port=self.http_port, loop=loop)

if __name__ == '__main__':
    server = FireEmergencyServer(udp_port=5006, http_port=8080)
    server.run()