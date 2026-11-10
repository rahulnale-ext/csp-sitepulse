# CSP Data Manager — Angular + Firebase Web Push

We will use four services. You do not need to buy a domain to get started.

* Google Apps Script — backend and automatically created Google Sheets

* Cloudflare Workers — secure connection between frontend and backend

* Firebase — web push notifications

* GitHub Pages — hosting your Angular frontend

## Decoupled Frontend with True Web Push (Advanced)

To achieve native Web Push and Mobile Push without relying on third-party client wrappers, you must separate your frontend UI from Google Apps Script entirely.

* The Setup: Host your frontend HTML and JavaScript on a standard static hosting provider (like GitHub Pages) where you have root domain access to register a Service Worker.

* The Code: Integrate Firebase Cloud Messaging (FCM) into this newly hosted frontend. Your Apps Script now functions strictly as a backend API. When a notification event occurs, the Apps Script sends a POST request to the FCM API, which then pushes the alert to all browsers and devices that have subscribed to your standalone web app.

* Create a DOM style complete Angular ultra-modern stylistic web app frontend.

* Use Isha Logo. Do not add any external graphics and designs graphics. Use Sadhguru related style and fonts.

* You create your own spreadsheet instead of me uploading a new one - using a function in Appscript, a new spreadsheet will get created in the same Google account.

* Jira tickets synchronising automatically when I select the supervisors. Give a button for syncing manually.

* Give a drop-down menu for selecting item filters in the admin page for supervisors, instead of placing all the items open and out.

* Integrate Gemini for voice reports. Supervisors speak specific updates daily, and an automated report is generated. They need to verify the report, make changes if required, and then press the submit button. Supervisors speak in local languages: Tamil, Kannada, Telugu, Bengali, Marathi, Hindi, and Malayalam. Provide language options for the web app, and ensure the app is created for these local languages as well. Test the meaning thoroughly after translation.

* Leads sometimes send the report back to the supervisor for revision. Leads can type the required message in any language they wish, but the supervisor should see the translation in their local language.

* Do not make the UI too roomy. Make it compact, easy to read, and understandable, with static and collapsible left menu bars. Keep the top menu bar as short as possible. Use the Isha logo and create a backdrop on the website with a slightly visible logo in the background. Use the logo in the top-left corner as the home button for all entities.

* Provide an option for the admin to rename the menu options directly from the website.

* Do not add any advertisements or display the names of the technologies used to build the app.

* Display Jira data exactly as it is developed in the Jira section. Just change the graphics to match our website's style.

* Check each button, button style, pop-up, text, and image thoroughly across all devices and browsers.

* Name the App in 2-3 words max. "CSP" something something

1. Frontend: Angular, TypeScript, responsive CSS, installable PWA

2. Backend: Existing Google Apps Script functions and Google Sheets

3. Notifications: Firebase Cloud Messaging, foreground and background delivery

4. Security: Email Password and OTP, server-validated sessions, role permissions, private FCM credentials