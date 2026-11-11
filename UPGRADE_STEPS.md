# CSP SitePulse — Update existing installation (November 2026)

**Follow these steps in order. Use a computer. Do not delete any spreadsheets or the existing Apps Script deployment.**

## Files you need

1. `csp-sitepulse-v2.zip` — updated website + backend source. This is intended to be uploaded to your source repository.
2. `CSP-PRIVATE-STAFF-SETUP.gs` — private roster setup. **Never upload or copy this file to GitHub, GitHub Issues, or public websites.** Put it **only inside your private Google Apps Script editor**.

## 1 — Make a backup

1. Keep the earlier CSP SitePulse ZIP and a copy of your current local GitHub repository.
2. In [Google Apps Script](https://script.google.com/), open **CSP SitePulse Backend**.
3. Open `Code.gs`. Copy all existing code into a local text file called `CSP-Code-Backup.txt` and keep it privately.
4. Open **Project Settings → Script Properties**. Privately record the *names* of properties in use; do not put their secret values into GitHub.
5. Open the operations spreadsheet and verify it contains your existing data. Do not delete any tabs.

## 2 — Update the Google Apps Script backend

1. Open the **new** ZIP and extract it.
2. In the extracted `csp-sitepulse` folder, open `backend/Code.gs` using Visual Studio Code.
3. Copy all its contents.
4. Return to your existing Apps Script project. Open `Code.gs` and replace its contents with the copied code.
5. Click **Save**.
6. Select the function `setupProject` from the dropdown next to **Run**.
7. Click **Run** and approve permissions if requested.
8. Confirm the execution finished successfully. Your **existing spreadsheet IDs are reused**; the new tables/columns are added.
9. Open the operations spreadsheet. Check for tabs **Direct_Messages**, **Item_Rates** and **CSP_Staff_Profiles**.

**Error?** Click **Executions**, open the failed run and record the first red error. Restore your backed-up code if necessary. Do not run initialization functions that create or replace existing spreadsheets.

## 3 — Load the private staff roster

1. On your computer, open the separate downloaded `CSP-PRIVATE-STAFF-SETUP.gs` file in Visual Studio Code.
2. Copy all its contents.
3. Return to the **same private Apps Script project**.
4. Next to **Files**, click **+ → Script**.
5. Name the file `PrivateStaff`.
6. Paste the copied code into `PrivateStaff.gs` and click **Save**.
7. Select `seedPrivateCspStaff` from the function dropdown.
8. Click **Run**.
9. Open your **operations** Google Sheet → `CSP_Staff_Profiles`. Check the staff names, role labels, email addresses and mobile numbers carefully.
10. If any entries are incorrect, correct them in `CSP_Staff_Profiles` **before importing people into Users**.

**Important:** These staff entries are marked **pending review**. No new supervisor or lead account is enabled automatically; exact reporting-lead relationships must be assigned by your administrator.

**Error: “Run setupProject first”** — complete Step 2 and try again.

**Error: “Invalid roster”** — delete only the incorrectly pasted contents of the `PrivateStaff.gs` file, re-copy the provided private file and run again.

## 4 — Redeploy the Google backend

1. In Apps Script click **Deploy → Manage deployments**.
2. Find your existing Web app. Click **Edit** (pencil).
3. Under **Version**, choose **New version**.
4. Click **Deploy**.
5. Verify the web app URL still ends in `/exec`. Keep the existing deployment instead of creating a duplicate if possible.
6. Open that `/exec` URL and check it says `status: ready`.
7. If the URL changed, open **Cloudflare → Workers → your Worker → Settings → Variables and Secrets**, and update `APPS_SCRIPT_URL` with the new URL.

**Error: 403/404/502** — verify Web app permissions and the saved Worker secret. Do not share the secret values publicly.

## 5 — Update the existing GitHub website

1. Open **GitHub Desktop**.
2. Select your existing `csp-sitepulse` repository, not a new repository.
3. Click **Repository → Show in Explorer** (Windows) or **Show in Finder** (Mac).
4. In this local repository, make a backup copy of `src/app/environment.ts`. **This may contain your working public Firebase settings and Worker URL.**
5. From the extracted **new ZIP**, copy its folders and files into the existing local `csp-sitepulse` folder, choosing **Replace** for matching files.
6. Restore your previously backed-up `src/app/environment.ts` into the repository so your website retains its working connection settings.
7. **Do not copy `CSP-PRIVATE-STAFF-SETUP.gs` into the repository.** It is not part of the ZIP.
8. Return to GitHub Desktop. Review **Changes**. Make sure no password, service-account JSON, Jira token, Gemini key or private roster file was added.
9. Enter the commit message `Update CSP SitePulse features`.
10. Click **Commit to main → Push origin**.
11. Open GitHub.com → repository → **Actions → Publish CSP SitePulse**.
12. Open the newest run. Verify **build** and **deploy** are both green.
13. Open **Settings → Pages → Visit site** or your usual SitePulse link. Hard refresh with `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac).

**Error: Dependencies lock file not found** — verify `.github/workflows/deploy.yml` uses `with: {node-version: '22'}` **without** `cache: npm`; commit and push that fix.

**Other red build error** — open the red `build` job, copy the **first red error** and fix it before trying deployment again. The source checks included with this delivery **do not guarantee** the production Angular build succeeds.

**Privacy warning:** If the previous public GitHub repository already contained personal staff emails/phone numbers in `Code.gs`, **replacing that file does not erase it from Git history**. Restrict repository access and obtain help recreating a clean repository/history before using it publicly. Do not put the private roster setup file in the repository.

## 6 — Activate staff safely

1. Sign in as admin at your SitePulse URL.
2. Open **Team**.
3. Click **Import provided staff** only after checking the `CSP_Staff_Profiles` spreadsheet.
4. All newly imported profiles should say **Pending review**.
5. Open one person → **Edit**.
6. Confirm their name, email and role. For supervisors, select the correct **Reports to** lead.
7. Set **Access status → Active** only after checking the account.
8. Click **Save**.
9. Repeat for approved staff. Keep unclear accounts pending.

**Error: Assign a reporting lead** — choose a lead before activating that supervisor.

## 7 — Check Jira field IDs and sync

1. In Apps Script → **Project Settings → Script Properties**, keep or correct the Jira field IDs for `IESM_Location`, Contact Number, Request Type, Sub-Request Type, Design Needed and Jira assignee fields. The image labels alone cannot reveal their custom field IDs.
2. Sign in as admin → **Jira → Test connection**.
3. Click **Sync CIVIL** or **Tickets → Sync**.
4. Open **Tickets** and compare Key, Created, Summary, Status, `IESM_Location`, Contact Number, Request Type, Sub-Request Type, Design Needed, Assignee and Reporter with your Jira screenshot.
5. Try filters for **Supervisor**, **IESM_Location** and **Created date**.
6. Do not manually reassign a ticket that Jira has already assigned unless you deliberately want to override the assignment.

**Missing column values?** Confirm the exact `customfield_...` IDs in Jira and update Script Properties; then sync again. The app does not invent missing Jira data.

## 8 — Test two-person messaging and device notifications

1. Sign in as admin in Chrome on your computer.
2. Sign in with a **different active test account** in another supported browser/device.
3. Open **Messages** on account A and send a short test message to B.
4. Check that B sees the message when the app refreshes (visible app checks roughly every **12 seconds**).
5. On both devices click the **bell → Enable device alerts**. Approve permission.
6. Click **bell → Test** and verify an operating-system notification appears.
7. Send another message with one screen in the background; check the OS push alert if Firebase is correctly configured.
8. If push fails, verify Firebase VAPID key, FCM service-account Script Property, and browser notification permissions.

**Limit:** The visible app checks for changes roughly every 12 seconds, and Firebase gives **best-effort** push. This is **not guaranteed instant**; updates made externally in Jira appear only **after synchronization**, not automatically from Jira without an additional webhook/periodic trigger.

## 9 — Check daily reports, rates and workbook

1. On a **test supervisor** account, open **Reports**, choose an assigned ticket, and speak or type an update.
2. Use **Analyze** if Gemini is enabled. Answer important follow-up questions, if any.
3. Check that every number and unit matches the original statement. Correct any errors before ticking **Verified**.
4. Confirm the **DAILY SITE REPORT** preview has each named labour/material/equipment field and uses **Not Used** when absent.
5. Submit. On a test lead account, verify the full report, then approve or request revision.
6. On the admin account, open **Resources**. Change a test item's rate; check **Old rate / Current rate** and **Rate register**.
7. Open **Workbook**, choose a test column, change its heading and verify existing data/formulas remain intact.
8. Open **Settings** and save a test profile's name, phone, birth date and photo. Check the `Users` spreadsheet.
9. To change email, request and enter the code delivered to the **new** address before saving.
10. Test on a phone and desktop browser before activating real staff.

**If anything fails:** Stop at that step. Note the step number and the exact error, take a screenshot, and do not delete records or secrets to troubleshoot.
