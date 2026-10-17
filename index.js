export default {
  id: 'ui-picker',
  label: 'UI Picker',
  description: 'Pick a component in the enterprise web app and start a session about it.',
  help: 'Install the bookmarklet from /ext/ui-picker/install.html on this wrangler.',
  author: 'Andrew Whitehead',
  defaultEnabled: true,
  engines: { wranglerApi: '^1.29.0' },
  requires: ['sessions:spawn', 'board:broadcast'],
  settings: [
    { key: 'repoPath', type: 'text', label: 'Repository path', help: 'Checkout new sessions start in. Empty uses ~/vcs/enterprise.', placeholder: '~/vcs/enterprise' },
    { key: 'allowedOrigins', type: 'list', label: 'Allowed page origins', help: 'Pages whose picks the launch popup accepts. Empty uses http://localhost:3333 and http://localhost:1234.' },
    { key: 'useWorktree', type: 'toggle', label: 'Start in a new worktree', help: 'Off starts the session in the checkout itself. Unset counts as on.' },
    { key: 'taskId', type: 'text', label: 'Task id', help: 'Optional board task new sessions are filed under.' },
  ],
  handlers: [],
  skills: [],
};
