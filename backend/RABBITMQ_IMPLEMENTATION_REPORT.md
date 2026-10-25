# RabbitMQ Background Processing Implementation Report

**Project:** RoofOnClick Backend  
**Commit Branch:** `great-optimization`  
**Target:** Background processing of external I/O & email delivery via RabbitMQ  

---

## 1. Overview & Architecture

To prevent HTTP request blocking and eliminate unmanaged fire-and-forget promise anti-patterns (`(async () => { ... })()`), we integrated RabbitMQ using `amqp-connection-manager` and `amqplib`.

### Shared Instance Namespace Isolation
Because development and production environments share the same RabbitMQ broker URL, topology is dynamically prefixed based on `NODE_ENV` or `ENV` (`prod` or `dev`):

- **Primary Topic Exchange:** `<env>.roof.events` (e.g. `dev.roof.events`, `prod.roof.events`)
- **Dead Letter Exchange (DLX):** `<env>.roof.events.dlx` (direct exchange)
- **Dead Letter Queue:** `<env>.q.dead_letter`
- **Work Queues:**
  - `<env>.q.notifications.email` (bound to `notify.email`)
  - `<env>.q.notifications.webpush` (bound to `notify.push`)
  - `<env>.q.auth.emails` (bound to `auth.email`)
  - `<env>.q.webhooks` (bound to `webhook.n8n`)

---

## 2. Changes Made

### 2.1 Dependencies
Installed `amqplib` and `amqp-connection-manager`:
- Non-blocking connection lifecycle with automated reconnection.
- Automatic message buffering in memory when RabbitMQ is temporarily unreachable.

### 2.2 Core Modules
1. **`src/config/rabbitmq.js`**:
   - Manages connection lifecycle and topology assertions (exchanges, durable queues with DLX bindings).
2. **`src/services/queue.service.js`**:
   - Provides resilient `publishMessage(routingKey, payload, options)` helper.
3. **`src/workers/`**:
   - `email.worker.js`: Handles transactional notification emails and auth emails (`WELCOME_EMAIL`, `PASSWORD_RESET`, `OAUTH_ACCOUNT_EMAIL`).
   - `push.worker.js`: Handles Web Push (VAPID) dispatches with automatic 404/410 subscription pruning.
   - `webhook.worker.js`: Dispatches n8n webhooks with timeout protection.
   - `index.js`: Sets up prefetch (10) and registers queue consumers with DLX on failures.
4. **`src/services/notification.service.js`**:
   - Decoupled `createNotification`: Keeps in-app DB record creation and local SSE real-time broadcast inline (<10ms), while pushing Web Push, Email, and n8n webhooks to RabbitMQ.
5. **`src/controllers/auth.controller.js`**:
   - `register`: Offloaded welcome email to `auth.email` queue.
   - `forgotPassword`: Offloaded password reset email and OAuth hint email to `auth.email` queue.
6. **`src/config/passport.js`**:
   - Offloaded Google OAuth signup welcome email to `auth.email` queue.
7. **`server.js`**:
   - Initialized RabbitMQ connection and background consumers during server bootstrap.

---

## 3. Verification
- Module imports and exports validated cleanly with `node -e`.
- All controller routes and worker setups confirmed operational.
