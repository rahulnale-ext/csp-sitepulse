/** Public frontend configuration only. Never put Jira/Gemini/FCM server credentials here. */
export const environment = {
  apiUrl: 'https://YOUR-CLOUDFLARE-WORKER.workers.dev/',
  firebase: {
    apiKey: 'YOUR_PUBLIC_FIREBASE_API_KEY',
    authDomain: 'YOUR-PROJECT.firebaseapp.com',
    projectId: 'YOUR-PROJECT',
    messagingSenderId: 'YOUR-SENDER-ID',
    appId: 'YOUR-FIREBASE-APP-ID'
  },
  vapidPublicKey: 'YOUR_PUBLIC_FCM_VAPID_KEY'
};
