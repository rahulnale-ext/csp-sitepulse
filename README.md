# CSP SitePulse

A compact, role-aware civil field-operations web application based on the supplied `Code.gs`, CSP requirements, and Isha logo. The application is **source code, not a hosted live service**. It cannot send real email, query Jira, use Gemini, or deliver push until the owner deploys/configures the external services.

## Project contents

- `src/`: standalone Angular web app, responsive dashboard, staff/ticket/report flows, workbook viewer and notifications.
- `backend/Code.gs`: adapted original Apps Script. The updated version includes persisted admin menu labels, Marathi revision translations, and an RPC logout fix.
- `worker/`: an origin-restricted Cloudflare Worker proxy (no backend URLs or secret credentials in the frontend).
- `public/`: installable PWA manifest, local icons, combined PWA shell + Firebase token service worker.
- `.github/workflows/deploy.yml`: GitHub Pages deployment pipeline.
- `REQUIREMENTS.md`: original requirements for comparison.
- `preview/index.html`: **static, nonfunctional** design-only page using fictional sample values (never connected to Sheets).

## 1. Prepare Google Apps Script and spreadsheets

1. Create a Google Apps Script project in the intended Google account, or update your existing project **after backing it up**. Replace its `Code.gs` contents with `backend/Code.gs`; do not paste the frontend into Apps Script.
2. Set the Apps Script time zone to `Asia/Kolkata` if appropriate. From the editor, run `setupProject()` once, approve access, and inspect the log URLs. It creates an operations workbook and reporting workbook automatically. Existing workbook IDs are reused rather than deleted.
3. Run `authorizeMailService()` once, and optionally `installSessionCleanup()` and `installDailyReportReminder()`.
4. Check the `Users` sheet. Your owner account is created as admin on first setup. Staff may sign in **only when their exact email is registered**, with supervisors assigned to a lead. Admins can manage personnel from the web UI after deployment.
5. Deploy as Web App: **Execute as me** (the owner) and choose a publicly invocable endpoint (`Anyone`, subject to your organization's policy) because browsers reach it through the Worker. The Apps Script itself enforces server-side session authentication and roles. Copy the `/exec` endpoint for the Worker.
6. When changing `Code.gs` later, deploy a **new web-app version**. Keep all credentials in Apps Script project properties, never in the repo.

### Optional backend Script Properties

| Property | Purpose |
|---|---|
| `SPREADSHEET_ID`, `REPORTING_WORKBOOK_ID` | Created by setup; no manual upload needed |
| `JIRA_BASE_URL` | HTTPS Jira root, e.g. your Jira host |
| `JIRA_API_TOKEN` | Jira token, private |
| `JIRA_AUTH_MODE`, `JIRA_EMAIL` | `bearer` (default), or basic + email if supported |
| `JIRA_*_FIELD`, `JIRA_EXTRA_JQL` | Optional custom fields and civil filter as noted in `Code.gs` |
| `GEMINI_API_KEY` | Gemini interpretation/translation server key, private |
| `GEMINI_MODEL` | Optional, defaults to `gemini-2.5-flash` in supplied backend |
| `FCM_PROJECT_ID` | Firebase project ID |
| `FCM_SERVICE_ACCOUNT_JSON` | Complete Firebase messaging service-account JSON, private |
| `PUSH_APP_URL` | Published GitHub Pages application URL |
| `SITE_TIMEZONE` | Optional, e.g. `Asia/Kolkata` |

**Do not** add Jira tokens, Gemini keys, service account JSON, or the secret Worker upstream endpoint to client-side configuration.

## 2. Deploy the Cloudflare Worker

1. Install Wrangler locally (`npm install -g wrangler`) or use Cloudflare's dashboard editor.
2. In `worker/`, deploy `index.js` with its `wrangler.toml`: `npx wrangler deploy`.
3. Configure two Worker secrets: `APPS_SCRIPT_URL` = full deployed Apps Script `/exec` URL; `ALLOWED_ORIGIN` = exact web origin, such as `https://YOUR-USERNAME.github.io` **without a trailing slash or repo path**. Use `npx wrangler secret put APPS_SCRIPT_URL` and `npx wrangler secret put ALLOWED_ORIGIN`.
4. Validate a browser request from the allowed GitHub Pages origin. The Worker rejects other `Origin` headers and forwards JSON POST to Apps Script without caching.

The Worker is a transport/gateway layer, **not** a substitute for Apps Script's session and role checks. A forged Origin header alone is not a credential.

## 3. Configure the frontend and publish

1. Install Node.js 22 or a compatible supported version.
2. Run `npm install` in the project root, then `npm start` for local preview.
3. Update `src/app/environment.ts`:
   - `apiUrl`: your Worker HTTPS endpoint, ending in `/`.
   - `firebase`: the **public web-app** Firebase config from the Firebase console (the public Firebase API key is **not** the service account JSON).
   - `vapidPublicKey`: Firebase web push public VAPID key.
4. In Firebase console, enable Cloud Messaging API and add your GitHub Pages origin to any required allowed/auth domains. Configure project messaging credentials for the Apps Script backend.
5. Push this project (excluding secrets) to GitHub repository `main`, and enable GitHub Pages with **GitHub Actions** as the publishing source. The workflow builds with `/${repositoryName}/` as Angular base href for a standard project-pages repo.
6. Open your Pages URL on HTTPS, sign in using your registered email and the eight-digit code, and allow notifications only when you choose.

For a special `username.github.io` repository hosted at the root, change the GitHub workflow's build `--base-href` argument to `/`.

### API request contract

```json
{"method":"getBootstrap","args":[],"sessionToken":"<session token from verifyLoginCode>"}
```

The Worker forwards this shape to Apps Script and returns `{ "ok": true, "result": ... }` or `{ "ok": false, "error": ... }`. The session token is kept in **browser session storage** (not a publicly readable URL). Server-side sessions expire according to the provided backend.

## 4. What works when configured

- Admin: automatic/manual CIVIL issue sync, assignment to supervisors, Jira details (all mapped fields, issue links, comments and budget notes), staff accounts, resource catalogue, admin menu labels, reporting workbook access.
- Lead: their scoped tickets and reports, review quantity edits, approve, or request revisions in their own language.
- Supervisor: their assigned tickets, voice transcript capture (browser-dependent), Gemini extraction where enabled, manual corrections, explicit verification checkbox, report submission, translation of revision notes, and resubmission.
- All users: compact responsive navigation, language picker (English + Tamil/Kannada/Telugu/Bengali/Marathi/Hindi/Malayalam), notifications, dashboard and email-code login.
- PWA: installability, minimal offline shell fallback, web push opt-in, foreground and background notification handling through the app service worker.

## 5. Known boundaries (do not claim these were tested live)

- **Email+password is not present in the supplied backend**, which uses passwordless, 8-digit email OTP. This project preserves that established server-validated flow. A true **password plus OTP** requirement would need a separately designed and security-reviewed server credential flow (or a managed authentication provider) that the backend verifies. A password box in the UI alone would not be secure.
- UI vocabulary has draft translations for seven Indian languages, but not every help/error/backend message is fully localized. **Native-speaker review of construction terminology and translation meaning is still required.** Gemini translations should always be verified before action.
- Voice recognition depends on browser support and microphone permission. Typed transcription/manual reporting remains available.
- Apps Script already provides best-effort FCM and notifications; live foreground/background delivery must be validated against the actual Firebase project, VAPID key and deployed site on each target browser/device.
- Not all backend administration endpoints are surfaced as screens (e.g., directory columns, advanced lead-time rules, bulk legacy tools); the key workflow screens are implemented.
- The GitHub Pages subpath must match base href and service worker scope. GitHub Pages requires public HTTPS access; no purchased domain is needed.
- Live API/browser integration, cross-browser QA, performance and accessibility audits cannot be claimed without credentials or a deployment. `npm install` was not possible in the artifact authoring environment, so the Angular compiler/build was not executed here. Run the tests/compile in your connected development or CI environment before production rollout.

## 6. Suggested acceptance checks

Test with **separate accounts** for admin, lead and supervisor; check an invalid/expired OTP and logout; test role isolation on requests; run one manual and one selection-triggered CIVIL sync; verify Jira detail fields; submit and revise a report in all seven spoken languages; compare each AI-generated quantity with the transcript; exercise push foreground/background/notification-click on Chrome, Edge, Safari and Android browsers where supported; test 320/375/768/1440px widths; verify workbook formula preservation and that secrets never appear in bundled JS.
