# QA & Testing Guide: Backend Performance, Database & Queue Optimization

**Target Branch:** `testing`  
**Target Environment:** Development / Staging / Production  
**Scope of Changes:**
1. Database Query Optimizations (Aggregation pipelines, bulk operations, compound indexes, ACID transactions).
2. Redis Read Caching & Zero-Stale Cache-Aside Invalidation.
3. RabbitMQ Asynchronous Background Processing (Transactional emails, Web Push, and webhooks).

---

## 1. Test Objectives & Strategy

The testing team should verify three core outcomes:
1. **Functional Integrity:** Endpoints return identical data structures, status codes, and business outcomes as before.
2. **Data Consistency & Freshness:** Cached reads update immediately when mutations occur (no stale data).
3. **Async Processing Reliability:** Emails, Web Push notifications, and webhooks are processed in the background without holding up client HTTP responses.

---

## 2. Test Suites & Test Cases

### Suite A: Database & Query Performance

#### Test Case A.1: City Registry Aggregation (`GET /api/listings/cities`)
- **Objective:** Verify city list returns without N+1 query loop.
- **Steps:**
  1. Send `GET /api/listings/cities`.
  2. Verify HTTP response is `200 OK`.
- **Expected Result:**
  - Response payload contains `cities` array where each item has `name`, `state`, and accurate `count` of active listings.
  - Initial request takes < 100ms; subsequent requests take < 10ms (cached).

#### Test Case A.2: Review Summary Aggregation (`GET /api/reviews/property/:id/summary`)
- **Objective:** Verify rating summaries and distribution calculations match stored review data.
- **Steps:**
  1. Identify a listing with multiple ratings (1 to 5 stars).
  2. Send `GET /api/reviews/property/:id/summary`.
- **Expected Result:**
  - Total count, overall average rating, category averages (`cleanliness`, `amenities`, `valueForMoney`, `location`), and `distribution` breakdown (1-5 star counts) accurately match the underlying reviews.

#### Test Case A.3: Batch Room Addition (`POST /api/crm/rooms/batch`)
- **Objective:** Verify bulk room creation uses bulk writes without partial failure inconsistency.
- **Steps:**
  1. As an authorized owner or admin, send a batch of 5-10 rooms to `POST /api/crm/rooms/batch`.
- **Expected Result:**
  - Returns `201 Created` with created rooms.
  - All rooms are persisted with correct inventory numbers.

#### Test Case A.4: ACID Transaction in Booking Payment Finalization (`POST /api/payments/verify`)
- **Objective:** Verify atomic updates across Payment, Booking, and Room Inventory.
- **Steps:**
  1. Complete a test Razorpay checkout transaction for a listing with limited room inventory.
  2. Trigger payment verification.
- **Expected Result:**
  - Payment record status becomes `captured`.
  - Booking status transitions to `confirmed`.
  - Room inventory `availableCount` decrements by 1 atomically.
  - In case of simulated payment record failure, no partial inventory change or booking state is orphaned.

---

### Suite B: Redis Caching & Zero-Stale Invalidation

#### Test Case B.1: Environment Prefix Verification
- **Objective:** Verify Redis keys are prefixed by environment (`dev:` or `prod:`).
- **Steps:**
  1. Perform reads on listings or cities.
  2. Inspect Redis using redis-cli or GUI.
- **Expected Result:**
  - All created keys begin with `dev:` (in development/staging) or `prod:` (in production).
  - No unprefixed keys exist.

#### Test Case B.2: Zero-Stale Listing Updates & Invalidation
- **Objective:** Ensure property detail edits immediately clear cached responses.
- **Steps:**
  1. Send `GET /api/listings/:id` (inspect response time; first is DB fetch, second is sub-5ms Redis cache hit).
  2. Make an update to the listing via `PUT /api/listings/:id` (e.g., change `title` or `rent`).
  3. Immediately send `GET /api/listings/:id`.
- **Expected Result:**
  - Step 3 returns the newly updated values immediately.
  - Key `dev:listing:detail:<id>` was evicted on the `PUT` request.

#### Test Case B.3: Global Search Version Invalidation
- **Objective:** Verify global listing search version bumps on new listing creation or deletion.
- **Steps:**
  1. Execute search query `GET /api/listings?city=Indore`.
  2. As an owner, create a new listing in Indore via `POST /api/listings`.
  3. Re-run `GET /api/listings?city=Indore`.
- **Expected Result:**
  - The newly created listing appears in search results immediately without waiting for TTL expiry.

#### Test Case B.4: Review Invalidation
- **Objective:** Ensure submitting a review invalidates both review list and review summary caches.
- **Steps:**
  1. Request review summary: `GET /api/reviews/property/:id/summary`.
  2. Post a new review: `POST /api/reviews`.
  3. Immediately re-fetch summary and review list.
- **Expected Result:**
  - New review appears in the list and ratings average reflects the updated calculation.

#### Test Case B.5: User Profile Invalidation
- **Objective:** Verify user profile updates clear cached user data.
- **Steps:**
  1. Fetch `GET /api/users/profile`.
  2. Update profile name via `PUT /api/users/profile`.
  3. Re-fetch `GET /api/users/profile`.
- **Expected Result:**
  - New profile name returns on the subsequent read.

---

### Suite C: RabbitMQ Background Processing & Async Delivery

#### Test Case C.1: User Registration Welcome Email
- **Objective:** Verify signup responds quickly while email is processed via queue.
- **Steps:**
  1. Submit a registration via `POST /api/auth/register`.
  2. Measure HTTP response time.
- **Expected Result:**
  - API responds with `201 Created` in < 250ms (not blocked by Resend API latency).
  - Background consumer processes the message from queue `dev.q.auth.emails`.
  - Welcome email is delivered to the registered inbox.

#### Test Case C.2: Forgot Password Token & Email
- **Objective:** Verify password reset request triggers async email dispatch.
- **Steps:**
  1. Request password reset via `POST /api/auth/forgot-password`.
- **Expected Result:**
  - API responds with `200 OK` generic message in < 150ms.
  - Message published with routing key `auth.email` to `dev.q.auth.emails`.
  - Password reset email is delivered with valid reset link.

#### Test Case C.3: In-App Notification & Web Push Decoupling
- **Objective:** Verify notifications write to MongoDB and emit SSE immediately, while Web Push runs via worker.
- **Steps:**
  1. Trigger an action that creates a notification (e.g. submit an enquiry or booking).
  2. Monitor SSE connection and Web Push inbox.
- **Expected Result:**
  - In-app notification appears instantaneously via SSE and MongoDB.
  - Web Push notification arrives asynchronously via `dev.q.notifications.webpush` without delaying HTTP response.

#### Test Case C.4: Dead Letter Queue (DLX) Fault Tolerance
- **Objective:** Verify poisoned or crashing payloads route to Dead Letter Queue without crashing the server.
- **Steps:**
  1. If bad data or unhandled message reaches a queue, worker rejects with `nack(msg, false, false)`.
- **Expected Result:**
  - Message routes to `dev.roof.events.dlx` and lands in `dev.q.dead_letter`.
  - Server and remaining consumer workers continue processing incoming messages without interruption.

---

## 3. Performance & Latency Benchmarks (Acceptance Criteria)

| Endpoint / Operation | Previous Latency | Target Latency | Pass/Fail Criteria |
| :--- | :--- | :--- | :--- |
| `GET /api/listings/cities` | ~180ms - 450ms (N+1) | < 15ms (Cache hit) | Pass if < 25ms |
| `GET /api/listings/:id` | ~120ms - 250ms | < 10ms (Cache hit) | Pass if < 20ms |
| `GET /api/reviews/property/:id/summary` | ~200ms - 500ms | < 15ms (Cache hit) | Pass if < 30ms |
| `POST /api/auth/register` | ~800ms - 1,800ms (Email wait) | < 250ms (Queued) | Pass if < 350ms |
| `POST /api/auth/forgot-password` | ~600ms - 1,500ms (Email wait) | < 150ms (Queued) | Pass if < 250ms |
| `POST /api/listings/:id` (Update) | Varied | < 200ms + zero stale reads | Cache evicted immediately |

---

## 4. Rollback & Troubleshooting Checks

If any issues occur during testing:
1. **Redis Connectivity:** Check Redis connection logs (`[Redis] Connected with prefix [dev:]`). Ensure `REDIS_URL` is accessible.
2. **RabbitMQ Connectivity:** Verify connection logs (`[RabbitMQ] Connected to broker [dev]`). If broker disconnects, messages buffer automatically in memory and re-dispatch on reconnect.
3. **Queue Health:** Verify RabbitMQ management console (or CloudAMQP dashboard) shows queues with zero unacknowledged message build-up.
