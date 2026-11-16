# CSP SitePulse V6 - React frontend

This is a React/Vite/TypeScript replacement for the earlier Angular user interface. It retains the Isha-inspired visual language and the existing Google Apps Script + Google Sheets + Cloudflare Worker backend. It includes React Router (hash routing for GitHub Pages), React Hook Form, fixed pop-up alerts, responsive navigation and a compact CIVIL ticket table.

## Safety and configuration

- Back up your original GitHub repository and Apps Script project before replacing code.
- **Keep your real `src/app/environment.ts`**. The one in this full project is a placeholder. The migration ZIP deliberately excludes that file. Do not publish secret API tokens, Jira credentials, private staff data or Firebase service-account JSON.
- All Jira reads use the existing Jira connection. The app does **not** change issue assignments on Jira. It changes only SitePulse/Google Sheets records.
- Keep your Cloudflare Worker and existing Script Properties in place. Deploy a **new version** of the same Apps Script Web app after replacing backend/Code.gs.
- The existing Firebase Cloud Messaging service worker stays in `public/firebase-messaging-sw.js`. Firestore messaging is not present.
- `npm run build` requires an internet-connected environment with package-manager access. GitHub Actions installs the dependencies and publishes the `dist` folder.

## Jira supervisor assignments - IMPORTANT

The old broad CIVIL import was mistaken for the filtered Jira supervisor views. As a result, assignee counts were inflated. The new **Tickets -> Preview Jira queues** action reads the current CIVIL Service Management queues without making any changes. **Sync verified queues** reads each matched person-named queue and writes the verified ticket-to-staff mapping into the existing SitePulse `Tickets` sheet; it does not write to Jira. Legacy broad CIVIL history is not treated as queue-verified assignment. A supervisor's personal ticket list uses only verified queue assignments or explicit admin overrides.

Supported display-name identity aliases include: Raju/Raju venkatesh, Balakrishnan/Balakrishanan, Kalairasan/Kalai, Vasanth/Vasant, Shiva/Siva, Vignesh/Vighnesh and Bankim. All other staff use their existing names. No staff names/emails are renamed.

**The private Jira screenshot might be displaying saved filters rather than JSM queues.** If the preview has no per-person queues, do not perform a broad import as a substitute. Ask the Jira administrator for the **numeric saved-filter IDs** for each supervisor's view. In Apps Script -> Project Settings -> Script Properties add `JIRA_SUPERVISOR_FILTERS_JSON` containing something like:

```json
{"Vasanth":{"filterId":12345,"group":"maintenance"},"Kalairasan":{"filterId":23456,"group":"maintenance"},"Raju":{"filterId":34567,"group":"new_works"}}
```

The numbers are **examples only**, not real filter IDs. Use the exact approved Jira saved-filter IDs, shared with the Jira API account. Accepted `group` values are `maintenance`, `new_works`, `new_projects`, `verified_filter`. The backend verifies each filter exists, checks CIVIL ticket keys, previews counts, then only links after explicit Admin synchronization. Do not configure this property until genuine filter IDs are known.

The currently visible Jira counts cannot be promised to match until the live Jira filter definitions and status restrictions are verified. Incorrect/broad historical assignments are deliberately kept out of supervisor counts in V6.

## Development and publishing

```
npm install
npm run check
npm test
npm run build
```

GitHub Pages: `vite.config.ts` defaults to base `/csp-sitepulse/` and the router uses `HashRouter`, avoiding 404s when refreshing a subpage. Publish with `.github/workflows/deploy.yml`; in GitHub repository Settings -> Pages select GitHub Actions.

Cloudflare Pages (optional): set environment variable `VITE_BASE_PATH=/`, build command `npm run build`, output folder `dist`. You must also update the allowed-origin value in the existing Worker and `PUSH_APP_URL` in Apps Script after moving the address.

The switch to React does not itself make Apps Script/Jira sync instantaneous. React paints local state updates immediately; foreground workspace refresh polls approximately every 15 seconds. FCM handles device notifications where configured.

## What has and has not been verified

Backend Apps Script JavaScript syntax and targeted Node regression tests pass. React/TSX files pass a transpilation syntax check. **A complete React production build and live authentication/Jira queue integration have not been verified** in the provided environment because npm dependency download was unavailable. Review GitHub Actions' green build/deploy jobs and test with two approved roles before retiring the Angular site.
