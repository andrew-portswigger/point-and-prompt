export default {
  id: 'ui-picker',
  label: 'UI Picker',
  description: 'Pick a component in the enterprise web app and start a session about it.',
  help: 'Setup steps, the bookmarklet and the settings are in this section. Save applies the settings.',
  author: 'Andrew Whitehead',
  defaultEnabled: true,
  engines: { wranglerApi: '^1.36.0' },
  requires: [],
  client: 'public/client.js',
  settings: [
    { key: 'repoPath', type: 'text', label: 'Repository path', help: 'Folder the new-session dialog starts in. Empty uses ~/vcs/enterprise.', placeholder: '~/vcs/enterprise', hidden: true },
    { key: 'allowedOrigins', type: 'list', label: 'Allowed page origins', help: 'Pages whose picks the board accepts. Empty uses http://localhost:3333 and http://localhost:1234.', hidden: true },
  ],
  handlers: [],
  skills: [],
};
