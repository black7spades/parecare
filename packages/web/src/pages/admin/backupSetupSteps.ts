import type { GuideStep } from '../../components/SetupGuide';

/**
 * The words for connecting Google Drive and Dropbox.
 *
 * Both consoles are built for developers and neither is kind. These steps
 * exist so nobody has to translate that on their own: each one names the
 * button they are looking for, opens the exact page, and gives them the
 * precise text to paste. Nothing assumes they know what a client, a scope or
 * a redirect is, because those are our words, not theirs.
 *
 * The tone matters as much as the accuracy. Someone doing this is usually
 * doing it because they are worried about losing records, and a console
 * shouting about credentials does not help. Every step says what it is for
 * and that it cannot be broken.
 */

export function googleSteps(redirectUri: string, alreadyHasApp: boolean): GuideStep[] {
  const steps: GuideStep[] = [
    {
      title: 'What this does',
      body: 'This lets PareCare put a copy of everything into your own Google Drive, so the records survive even if this server is lost. It takes about five minutes, and Google only ever lets PareCare see the files it puts there.',
      note: 'Google calls this part its Cloud Console. It looks technical and it is not friendly, but nothing here can break your Drive or your email.',
    },
    {
      title: 'Open Google Cloud and make a project',
      body: 'A project is just a folder Google keeps these settings in. Sign in with the Google account whose Drive you want the copies in, then make a new project. Any name will do, and PareCare Backups is a fine one.',
      link: { label: 'Open Google Cloud projects', url: 'https://console.cloud.google.com/projectcreate' },
      note: 'If you have used Google Cloud before, an existing project is fine too.',
    },
    {
      title: 'Turn on Google Drive',
      body: 'This tells Google that the project is allowed to talk to Drive. Make sure your new project is the one named at the top of the page, then press Enable.',
      link: { label: 'Turn on the Drive connection', url: 'https://console.cloud.google.com/apis/library/drive.googleapis.com' },
      note: 'If the button already says Manage, it is on and there is nothing to do.',
    },
    {
      title: 'Say who is allowed to use it',
      body: 'Google asks who this is for. Choose External, give it a name like PareCare, and use your own email address for the support and developer contact boxes. You can press Save and Continue past everything else.',
      link: { label: 'Open the permission screen', url: 'https://console.cloud.google.com/apis/credentials/consent' },
      note: 'On the Test users page, add your own Google address. Without it Google will refuse to let you connect later.',
    },
    {
      title: 'Allow it to save files',
      body: 'On the same permission screen, find Scopes and press Add or Remove Scopes. Search for drive.file and tick it. This is the narrowest permission Google offers: it can only see files PareCare itself created.',
      copy: { label: 'The permission to look for', value: 'https://www.googleapis.com/auth/drive.file' },
      note: 'If you see options mentioning all your files, those are not needed. Leave them alone.',
    },
    {
      title: 'Create the sign-in details',
      body: 'Press Create Credentials, then OAuth client ID, then choose Web application. Give it any name. Two values appear at the end, and the next step needs them.',
      link: { label: 'Open the credentials page', url: 'https://console.cloud.google.com/apis/credentials' },
    },
    {
      title: 'Add this address',
      body: 'On that same screen, find Authorised redirect URIs and press Add URI. Paste the address below exactly, with nothing after it, then press Save. This is the single most common thing to get wrong.',
      copy: { label: 'Paste this into Google', value: redirectUri },
      note: 'If Google later shows an error about a redirect address, come back and check this matches character for character.',
    },
  ];

  if (!alreadyHasApp) {
    steps.push({
      title: 'Bring the two values back',
      body: 'Google shows a client ID and a client secret when the credentials are created. Paste them here. You can find them again any time by opening the credentials page and clicking the name.',
      fields: [
        { key: 'client_id', label: 'Client ID', placeholder: 'ends with .apps.googleusercontent.com' },
        { key: 'client_secret', label: 'Client secret', secret: true, placeholder: 'a short jumble of letters' },
      ],
      saveLabel: 'Save and carry on',
    });
  }

  steps.push({
    title: 'Connect it',
    body: 'That is everything. Pressing Connect takes you to Google to say yes, and brings you straight back here. From then on every copy is kept in your Drive as well as on this server.',
    note: 'If Google refuses, come back to this guide and check the address in the step called Add this address.',
  });

  return steps;
}

export function dropboxSteps(redirectUri: string, alreadyHasApp: boolean): GuideStep[] {
  const steps: GuideStep[] = [
    {
      title: 'What this does',
      body: 'This lets PareCare put a copy of everything into your own Dropbox, so the records survive even if this server is lost. It takes about five minutes, and PareCare gets its own folder rather than the run of your account.',
      note: 'Dropbox calls this making an app. It sounds bigger than it is: it is a form with three answers.',
    },
    {
      title: 'Make the app',
      body: 'Press Create app. Choose Scoped access, then App folder rather than Full Dropbox, and give it a name such as PareCare Backups. App folder means it can only ever see its own folder.',
      link: { label: 'Open the Dropbox app page', url: 'https://www.dropbox.com/developers/apps/create' },
      note: 'If the name is taken, add something of your own to the end. The name is not used anywhere in PareCare.',
    },
    {
      title: 'Let it save files',
      body: 'Open the Permissions tab of your new app and tick files.content.write and files.content.read. Press Submit at the bottom. Without these it can connect but never actually save anything.',
      note: 'Nothing else needs ticking.',
    },
    {
      title: 'Add this address',
      body: 'Back on the Settings tab, find Redirect URIs and paste the address below, then press Add. This is the single most common thing to get wrong.',
      copy: { label: 'Paste this into Dropbox', value: redirectUri },
    },
  ];

  if (!alreadyHasApp) {
    steps.push({
      title: 'Bring the two values back',
      body: 'Near the top of the Settings tab are an app key and an app secret. The secret is hidden until you press Show. Paste both here.',
      fields: [
        { key: 'app_key', label: 'App key', placeholder: 'a short jumble of letters' },
        { key: 'app_secret', label: 'App secret', secret: true, placeholder: 'press Show in Dropbox to see it' },
      ],
      saveLabel: 'Save and carry on',
    });
  }

  steps.push({
    title: 'Connect it',
    body: 'That is everything. Pressing Connect takes you to Dropbox to say yes, and brings you straight back here. From then on every copy is kept in your Dropbox as well as on this server.',
  });

  return steps;
}
