# ROO-47 — Email Verification with Welcome Email + OTP — Final Plan

## 0. Status Tracker (updated as phases land)
- [x] **Phase 1** — OTP service + welcome mail with OTP, wired into register (no behavior change). Verified: unit + Redis roundtrip.
- [x] **Phase 2 backend** — `verify-email` / `resend-verification` / `verification-status` + `emailVerified` flag + login nudge. Verified: live E2E on :5055 (T1–T9, incl. 400/410/429/422 paths) + 9/9 controller harness.
- [x] **Phase 2 frontend** — verification service, `/verify-email` page, provider flags + `refreshUser`, signup/login redirects, 403 helper, `requireVerified` helper, real profile badges, navbar nudge. Verified: `tsc` 0 source errors, eslint clean on new code.
- [x] **Phase 3** — enforcement (`requireEmailVerified` + `code`), Google auto-verify, backfill script, frontend 403 redirect + entry gating. Verified: live E2E both directions + full cleanup.
- [x] **Debug hardening** — Resend `{ data, error }` rejection path now logged + returned (was silently swallowed); signup/login emit `otpIssued/mailSent` outcome lines; `/verify-email` Suspense boundary fixed.
- Open for staging: real-inbox render check; deploy-time backfill mode decision (§10 Q3).

## 1. Goal (from issue)
- New mail signup/login → welcome email **with OTP**.
- `Owner` without mail verify → cannot `POST /api/listings`.
- Normal `seeker` without verify → cannot Booking / Enquiry / Visit.
- Email only now. Same architecture must reuse for SMS/phone later.

Decision: **soft-gate** — login succeeds + returns tokens, but write actions return `403 EMAIL_NOT_VERIFIED`. Avoids lockouts.

## 2. Current State
### Backend (`roof-on-click-server/backend/src`)
- `models/User.model.js:81-88` — `isEmailVerified/isPhoneVerified/isVerified` exist default `false`, never set except Google `isVerified:true` (`config/passport.js:89`) + `create-admin.js`.
- `controllers/auth.controller.js:90-156 register` — creates user, `sendWelcomeEmail()`, returns tokens. No OTP.
- `services/email.service.js:406-435` — Resend branded template, no OTP block.
- `middleware/auth.middleware.js` — `verifyToken/requireRole`, no verification guard.
- Routes unguarded: `listing.routes.js:79 POST /` (owner), `booking.routes.js:14 POST /` (seeker), `enquiry.routes.js:26 POST /:listingId` (seeker).
- Infra ready: Redis (`config/redis.js`), Resend (`RESEND_API_KEY/FROM_EMAIL` in `.env`), `express-rate-limit`. Grep `otp` = 0 hits.

### Frontend (`roof-on-click-ui`, Next.js 16 App Router)
- Auth Context only: `providers/auth-provider.tsx:95,126-127`, tokens `lib/token-manager.ts:14-48` (memory AT + `localStorage _roc_sid` RT), cookie `_roc_has_session:21-33`.
- Signup `app/signup/page.tsx:73-107` → `auth-provider.tsx:176-199 POST /api/auth/register` → auto-login + redirect. Login `app/login/page.tsx:32-64` → `auth-provider:163-173 POST /api/auth/login`.
- OAuth callback `app/auth/callback/auth-callback-client.tsx:42-95` writes TokenManager directly, no `/me` fetch.
- API client `lib/api-client.ts:74-163` — attaches Bearer, handles `401` refresh only, **no 403 handling**.
- Owner: `app/owner/property/new/page.tsx` → `components/owner/wizard/property-wizard.tsx` → `wizard-context.tsx:891-909 handlePublish` → `services/listings/listings.api.ts:364-374 POST /api/listings`.
- Seeker: `pricing-card.tsx:204-212` BookNow → `requireAuth` → `booking-confirmation-modal.tsx:141-213` → `services/booking.ts:67-86 POST /api/bookings`. Enquiry `send-enquiry-modal.tsx:60-88` + `schedule-visit-modal.tsx:52-90` → `services/enquiry/enquiry.service.ts:70-76 POST /api/enquiries/:id`. Guards `property-details-client.tsx:500-502,562-570` use `requireAuth`.
- `User.isEmailVerified` typed `auth-provider.tsx:55` but never mapped in `normalizeUser:102-123`, never read. `profile/page.tsx:686-712` shows hardcoded Verified badges. No `verify-email` UI. Only dead OTP page `app/auth/verify-otp/page.tsx` (reset flow, deprecated stubs `auth.service.ts:77-91`).
- Guard: `middleware.ts:23-54` cookie-only, `hooks/use-require-auth.ts:12-34` login-only.

## 3. Architecture / Flow
```
register/login-unverified
 -> crypto.randomInt 6-digit -> sha256 -> Redis otp:email:<userId> TTL 600
 -> Redis cooldown 60s + attempt counter (max 5)
 -> sendWelcomeEmail(to,name,role,otp) via Resend (HTML+text)
 -> POST /verify-email {otp} -> compare -> User.isEmailVerified=true
 -> unverified POST /listings|/bookings|/enquiries -> 403 {code:EMAIL_NOT_VERIFIED}
 -> frontend intercepts -> /verify-email
```
Channel-agnostic day 1: `storeOtp(userId,channel,otp)` where `channel=email|sms`.

## 4. Backend Changes
1. **NEW `src/services/otp.service.js`** — `generateOtp/hash/store/verify/clear`, `otp:email:<id>` EX 600 (`OTP_EXPIRES_IN`), `otp:cooldown:<id>` EX 60, `otp:attempt:<id>` max 5, `otp:resend:<id>` 3/hr. Env: `OTP_EXPIRES_IN=600 OTP_RESEND_COOLDOWN=60 OTP_MAX_ATTEMPTS=5`.
2. **EDIT `src/services/email.service.js`** — `sendWelcomeEmail(to,name,role,otp)` add OTP hero block; NEW `sendVerificationOtpEmail()` for resend; `dispatchNotificationEmail` add `auth.email_verified`.
3. **EDIT `src/models/User.model.js`** — add `emailVerifiedAt: Date|null`. Reuse flags, no index.
4. **EDIT `src/controllers/auth.controller.js` + NEW `verification.controller.js`** — `register` (set false + send OTP + return `emailVerified:false`), `login` (if unverified re-send respecting cooldown + flag), NEW `verifyEmail/resendVerification/verification-status`.
5. **EDIT `src/middleware/auth.middleware.js`** — NEW `requireEmailVerified`: admin bypass, else if `!req.user.isEmailVerified` → `403 EMAIL_NOT_VERIFIED`.
6. **EDIT `src/routes/auth.routes.js`** — add `otpLimiter` (10/15min) + `resendLimiter` (5/hr), mount 3 routes.
7. **EDIT enforcement** — `listing.routes.js:79` +`requireEmailVerified`, `booking.routes.js:14` +same, `enquiry.routes.js:26` +same. Optional: review POST, listing photos POST.
8. **EDIT `src/config/passport.js:83-92`** — Google create/link set `isEmailVerified=true,isVerified=true,emailVerifiedAt=now`.
9. **NEW `src/scripts/backfill-verified.js`** — `updateMany → isEmailVerified:true` for existing users (recommended to avoid breakage).
10. **EDIT `.env.example`** — add 4 OTP vars.

API:
- `POST /register` mod → `201 {user(isEmailVerified:false), emailVerified:false}`
- `POST /login` mod → `200 {emailVerified:false}` if unverified
- `POST /verify-email (verifyToken) {otp}` → `200 verified` / `400 invalid` / `410 expired` / `429 attempts`
- `POST /resend-verification (verifyToken)` → `200 sent` / `429 retryAfter:60`
- `GET /verification-status (verifyToken)` → `{emailVerified,phoneVerified}`

## 5. Frontend Changes (`roof-on-click-ui`)
1. **`providers/auth-provider.tsx`** — map `isEmailVerified/isPhoneVerified` in `BackendUser+normalizeUser`; `signup/login` redirect to `/verify-email?email=&redirect=` when false; add `refreshUser() (GET /me)`; OAuth callback fetch `/me` after tokens.
2. **NEW `services/auth/verification.service.ts`** — `verifyEmail/resend/getStatus` via `apiClient`.
3. **NEW `app/verify-email/page.tsx`** — copy 6-box + countdown pattern from `auth/verify-otp/page.tsx:23-113`, wire to new service, 60s resend, success → `refreshUser` → role home. Don't revive `/auth/verify-otp` (dead reset baggage + dev `123456` hint).
4. **`lib/api-client.ts`** — typed `ApiClientError` + `isEmailNotVerifiedError()` helper (done P2). **Phase 3 adds**: central 403 auto-redirect to `/verify-email?redirect=<current>` (skips `/verify-email`, `/login`, `/signup`).
5. **Guards** — `hooks/use-require-auth.ts` `requireVerified(cb)` (done P2). **Phase 3**: swap `requireAuth` → `requireVerified` in `pricing-card.tsx` BookNow + `property-details-client.tsx` visit/enquiry triggers. Modals/wizard need no per-call handling (central 403 redirect covers them; backend stays source of truth).
6. **`app/profile/page.tsx:686-712`** — replace hardcoded badges with real `user.isEmailVerified/getStatus()`, `Verify Now` button.
7. **UX** — `navbar.tsx:209-231` unverified banner; `signup/login` pages preserve `redirect`; reuse `sonner` toasts. No new deps/env.

## 6. Security / Edge
- Hashed OTP, single-use, 10m TTL, 5 tries → invalidate, 60s resend cooldown, rate-limits. `userId` from JWT only. Resend overwrites old. Already-verified idempotent `200`. Redis down → `503` fail-closed (unlike auth blocklist fail-open). Dev mock logs OTP when Resend key missing.

## 7. Testing
- Unit: hash/match/expiry/attempt/cooldown. Integration: register→verify→`POST /listings 201`; unverified 3 routes →403; resend 429; Google auto-verified; expired 410. Frontend: signup→verify flow, Publish/Book/Enquiry gates, 403 interceptor, banner, Google no-verify.

## 8. Rollout
1. Backend OTP+email → endpoints → middleware+3 routes → passport+backfill → staging E2E.
2. Frontend service+verify page → provider+guards → profile/banner → staging E2E vs backend.
3. Prod: run backfill first, deploy backend, then frontend, monitor Resend+Redis.
4. SMS later: add `sms.service.js`, `POST /verify-phone`, `requirePhoneVerified`, reuse same pattern.

## 9. Acceptance
- [x] Signup gets welcome+OTP; verify → `isEmailVerified:true` (live E2E: Resend accepted send, correct-code 200; real-inbox render pending staging)
- [x] Unverified `POST /listings|/bookings|/enquiries/:id` →403 `EMAIL_NOT_VERIFIED`, frontend redirects (live-tested)
- [ ] Verified writes succeed; Google skips OTP; resend cooldown + lockout work (done); existing users backfilled (script ready, deploy-time decision); no hardcoded badges remain (done).

## 10. Open Decisions
1. 6-digit/10-min — adopted. 2. Soft-gate — confirmed. 3. **Backfill mode — deploy-time call**: script defaults to `--dry-run` (count only); `--apply` flips existing users. 4. Reviews/photo uploads — out of scope, only the 3 routes. 5. New `/verify-email` — built.

## 11. Phase 3 Execution Spec (locked)
Backend:
- `middleware/auth.middleware.js`: NEW `requireEmailVerified` (admin bypass; else 403 + `code: EMAIL_NOT_VERIFIED`).
- `utils/apiResponse.js`: `error()` accepts optional `code` (additive only).
- Routes: `listing.routes.js POST /`, `booking.routes.js POST /`, `enquiry.routes.js POST /:listingId` insert `requireEmailVerified` after role check.
- `config/passport.js`: Google create/link sets `isEmailVerified=true, emailVerifiedAt=now` (keep `isVerified` as-is).
- NEW `scripts/backfill-email-verified.js`: `--dry-run` default; `--apply` sets `isEmailVerified=true, emailVerifiedAt=now` where false; prints counts. Never runs automatically.
Frontend:
- `api-client.ts`: 403 + `isEmailNotVerifiedError` → redirect `/verify-email?redirect=<current>` (skip auth/verify pages).
- Swap to `requireVerified` at BookNow + visit/enquiry triggers.
Verify: live E2E with temp users (owner 403 on draft-listing, seeker 403 on booking/enquiry, verify → 201/200s), full cleanup, tsc/eslint, diff review. No commit/push/deploy.

## 12. Email Deliverability Runbook (added: Resend test-key restriction found live)
Symptom: signup returns 201 but no welcome/OTP mail arrives; server log shows
`Resend rejected … validation_error You can only send testing emails to your own
email address (roofonclick@gmail.com)`.
Root cause: `RESEND_FROM_EMAIL` empty → fallback `onboarding@resend.dev` (shared
test domain) + test-mode key → Resend rejects all non-owner recipients server-side.
No code change can override this. Proven: in-app `system.welcome` notification IS
created on signup (Mongo/SSE path, Resend-independent).
API-confirmed 2026-09-25: key is `restricted_api_key` (sending-only; `/domains`
→ 401) — cannot verify domain status with it, cannot mail non-owners. Permanent
fix needs dashboard action (below). Boot now warns loudly when FROM is unset.
NOTE: a key was pasted in chat — rotate it in the dashboard.
Permanent fix path A (recommended, no code change):
1. Resend dashboard (as roofonclick@gmail.com) → Domains → Add `roofonclick.com` →
   add SPF/DKIM records to DNS → wait for Verified.
2. `backend/.env`: `RESEND_FROM_EMAIL="RoofOnClick <noreply@roofonclick.com>"` (+ production key) → restart backend.
3. Re-test one real signup; expect `mailSent=true` in log. Ping dev to prove live.
Fallback path B (only if A impossible): Gmail SMTP relay via Nodemailer (needs new
dependency + Gmail app password for roofonclick@gmail.com) — requires explicit
approval + credential; Resend stays primary in plan architecture.
Testing aid (dev only, never production): rejected sends print `[DEV ONLY] OTP for
<email>` to the backend terminal when `NODE_ENV !== 'production'`.
