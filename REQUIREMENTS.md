# SitePulse V6 migration scope

- Replace Angular frontend with React 19, React Router, React Hook Form, TypeScript and Vite.
- Preserve existing Isha logo, compact forest-green style, role navigation, local language labels and backend.
- Show status/error/success messages as fixed, dismissible pop-up toasts visible wherever the user has scrolled.
- Improve ticket readability with a compact 12-column table, horizontal overflow only on small screens, and a thinner sidebar.
- Stop treating all CIVIL issues with matching generic Jira assignees as the Jira supervisor view. Verify each ticket against matched Service Desk queue or explicitly configured saved-filter ID before counting.
- Keep staff identities and Jira assignments unchanged. Manual SitePulse overrides are explicit, kept separate from automatic verification.
- Maintain existing manual report editing, multiple work quantities, rate history, approvals, spreadsheet editing and external communication shortcuts.
- Do not reinstate Firestore messaging or voice transcript generation. Preserve Firebase push notifications.
- Provide upgrade steps in the chat response, not a separate installation guide file.
