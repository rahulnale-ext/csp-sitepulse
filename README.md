# CSP SitePulse V4 — Firestore messaging update (November 12, 2026)

This is the **complete V3 project with the V4 messaging changes**, not just a code snippet. It preserves the existing Jira, inventory/rate history, Daily Site Reports, Google Sheets workbooks, voice report flows, Cloudflare Worker, and notification service worker. The **private staff roster and all credentials are deliberately excluded**.

## What's new

- Messages are sent to **Cloud Firestore** rather than the `Direct_Messages` spreadsheet.
- Each signed-in user receives live `onSnapshot()` updates to only conversations where they are a participant. There is **no 3-second message polling**.
- Message unread counts update as soon as the recipient opens the conversation and the read receipts are recorded in Firestore.
- Existing SitePulse **email OTP sign-in remains**. After the backend verifies the user's session, Apps Script signs a short-lived Firebase **custom authentication token** with the already configured private service account. Firebase browser sign-in is restricted to **memory-only persistence** so a SitePulse OTP session must be verified again when the page reloads.
- `firestore.rules` restricts message reads to participants, writes to the authenticated sender, read-receipt updates to the recipient, and denies all other access by default. A custom claim ties Firestore access to the SitePulse session expiry.
- Old spreadsheet messages can be **copied, without deletion**, by an admin using **Messages → Import old messages**. The migration uses authenticated Apps Script → Firestore REST with create-only preconditions so it will not overwrite existing messages or receipts.
- A best-effort server call verifies the stored Firestore message and sends a push notification via the existing FCM integration. The foreground chat update does not wait for push delivery.

## Important: this code is NOT deployed

Syntax checks, existing backend behavior tests, the Firebase JWT signature test, migration-format test, and static API integration tests passed. A real Angular production build **could not be executed** because dependency installation timed out. Firestore security rules have **not been emulator-tested**. Live Firestore authentication, FCM delivery, two-device timing, and message migration require testing on your project before production.

## Updating an existing V3 installation

1. **Back up** your existing GitHub project folder, Google Apps Script `Code.gs`, Google Sheets, and `src/app/environment.ts` outside your public repository.
2. In your **existing Firebase project**, create **Cloud Firestore (Standard)** in **Production mode** if it does not yet exist, and ensure **Firebase Authentication** is initialized. Use the existing project used for push notifications; do not create another project.
3. In Firebase Console → **Firestore Database → Rules**, open `firestore.rules` in this ZIP and **merge/publish** these rules. If your Firebase project already uses other Firestore collections, merge the `sitepulseMessages` rules into the existing policy rather than overwriting unrelated permissions. **Never set `allow read, write: if true` or leave database in test mode.**
4. In your **existing Apps Script** project, replace `Code.gs` with `backend/Code.gs`. Keep its Script Properties. Required: `FCM_PROJECT_ID` and `FCM_SERVICE_ACCOUNT_JSON`; the private JSON's `project_id` must equal `FCM_PROJECT_ID`. Save, and use **Deploy → Manage deployments → Edit → New version → Deploy**. Reuse your existing `/exec` URL. The existing Cloudflare Worker does not require changes.
5. In your existing local GitHub repository, copy the **contents** of this ZIP's `csp-sitepulse` folder over your existing project, including `.github`. Do not create a nested duplicate folder. Restore your real **`src/app/environment.ts`** from the backup so the Worker URL and the **public** Firebase web config remain correct. **Do not restore the old V3 `app.component.ts` or `app.component.html`.** Do not put `FCM_SERVICE_ACCOUNT_JSON` or staff contact details in the GitHub repository.
6. Open **GitHub Desktop → Changes**; inspect changes; commit `Enable Firestore messaging V4`; **Push origin**. In GitHub → **Actions → Publish CSP SitePulse**, both **build** and **deploy** must be green.
7. Open your existing site, e.g. `https://rahulnale-ext.github.io/csp-sitepulse/`; hard-refresh and sign in with a test user. Open **Messages**. It should show **● Live messaging** when connected. Test with a second **authorized staff account** in a separate device/browser. The message should appear automatically and the unread badge should clear when opened.
8. **Admin only, optional:** Open **Messages → Import old messages** once to copy historic `Direct_Messages` rows into Firestore. Verify sample conversations. Leave the old Google Sheet untouched as an archive; repeating the import skips existing Firestore document IDs.

These are also provided directly in the chat; there is intentionally **no separate installation-steps.md file**.

## Configuration and failure checks

| Symptom | Check |
|---|---|
| Website still says "Server address not configured" | Restore your working `src/app/environment.ts`, especially the Cloudflare `apiUrl`; push a new GitHub build |
| "Firestore messaging unavailable" | Firebase config is present in `environment.ts`; `FCM_PROJECT_ID` equals the Firebase `projectId`; `FCM_SERVICE_ACCOUNT_JSON` contains the correct private service account; redeploy Apps Script after updating its code |
| Firestore `permission-denied` | Confirm `firestore.rules` were published to the **same project and default database**; SitePulse OTP login completed successfully; Firebase Authentication initialized; Firestore access custom claim has not expired |
| Firebase `auth/invalid-custom-token` | Check that Firebase `projectId`, service-account `project_id`, and `FCM_PROJECT_ID` match and the private key JSON is valid |
| Message visible but push is delayed/missing | Firestore live messages are independent of push. Check FCM token registration and Apps Script Executions; the server verifies a Firestore document using Google service-account OAuth before sending push |
| Migration HTTP 403 | The service account must have permission to access Firestore (e.g. suitable Firestore/Datastore IAM role); ask your Firebase/Google Cloud administrator |
| GitHub build error | GitHub Actions → latest failed Build → first red error; do not keep changing unrelated files |
| Old conversation absent | Admin should run **Import old messages**. The V3 messages remain untouched in `Direct_Messages` until manually migrated |

**Security notes:** Firestore checks the authenticated Firebase UID and the `participantIds` of each message. Recipient IDs come from SitePulse's active contacts list in the UI; rules do not independently verify that the recipient is active. Only message reads and the UI stop immediately on sign-out; Firebase sessions are bound to the SitePulse session's expiry, but **administrator revocation of already signed-in users is not instantaneous**. Keep private service account credentials in Apps Script only, and consider short-lived revocation/active-directory checks before high-sensitivity production use.

**Cost/performance:** The implementation loads all messages belonging to the current user using a real-time Firestore query. It is appropriate as a starter for a modest staff group, but read usage rises as history grows and users reconnect. For large histories, add indexed pagination and per-conversation listeners before scaling. Firestore onSnapshot does not guarantee a particular arrival time on slow or offline networks. FCM background delivery is best-effort and still depends on browser/device permission.

## New files and changed files

- **New:** `src/app/firestore-chat.service.ts` — Firebase custom-token sign-in, realtime listener, send/read operations and cleanup.
- **New:** `firestore.rules` — participant-only security policy.
- **Updated:** `backend/Code.gs` — signed custom token, verified push, admin migration of legacy messages, notification-read sync; old Sheet messaging remains only for historical compatibility.
- **Updated:** `src/app/app.component.ts` and `.html` — wire existing Messages UI to Firestore, remove chat polling, add optional admin import button.
- **Updated:** `src/app/models.ts` — notification sender typing.
- **Updated:** `tests/update-contract.mjs`, `tests/v4-messaging.mjs` — V4 contract and token/migration tests.
- **Unchanged:** Cloudflare Worker, Github Pages workflow, logo, report/rate/Jira implementation, service worker, the public configuration placeholders.

### Developer checks

```bash
npm install
npm run check
npm run build
node tests/contract.mjs
node tests/update-contract.mjs
node tests/v3-behavior.mjs
node tests/v4-messaging.mjs
```

The GitHub Actions workflow automatically runs the Angular production build after each push; it does **not** deploy the Firestore Security Rules. Those must be published separately in Firebase Console.
