import type { LegalContent } from './types.ts';

// English legal texts. Operator data are placeholders until the operator fills them in.
export const en = {
  impressum: {
    title: 'Legal notice (Impressum)',
    sections: [
      {
        heading: 'Provider (§ 5 DDG)',
        body: ['<OPERATOR_NAME>', '<STREET_AND_NUMBER>', '<POSTAL_CODE_AND_CITY>, <COUNTRY>'],
      },
      {
        heading: 'Contact',
        body: ['E-mail: <EMAIL>', 'Phone (if required): <PHONE>'],
      },
      {
        heading: 'VAT ID',
        body: ['<VAT_ID_OR_REMOVE_THIS_SECTION>'],
      },
      {
        heading: 'Nature of the service',
        body: [
          'Skill-Based Front is a free browser strategy game for two players. There is no payment, no advertising and no editorial content.',
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy policy',
    sections: [
      {
        heading: 'Controller',
        body: [
          'The controller under the GDPR is the provider named in the legal notice: <OPERATOR_NAME>, <STREET_AND_NUMBER>, <POSTAL_CODE_AND_CITY>, <EMAIL>.',
        ],
      },
      {
        heading: 'In short',
        body: [
          'The game uses no cookies, no analytics, no advertising and no external services: the browser loads everything from this site only and does not contact third parties.',
        ],
      },
      {
        heading: 'Guest account and password',
        body: [
          'To play you pick a nickname (3 to 16 characters). The server stores the nickname, the time of registration and a SHA-256 hash of a random token it issues. The token itself is not stored on the server. If you set a password, the server stores only its hash (scrypt with a random salt); the password itself is neither stored nor logged. Logging in with nickname and password issues a new token and the previous one stops working. There is no password recovery: a forgotten password means you cannot log in from another device. There is no e-mail or real name. Do not use your real name as a nickname.',
          'Purpose: playing, telling players apart, the rating. Legal basis: Art. 6(1)(b) GDPR (providing the game) and Art. 6(1)(f) GDPR (operating a rated game). Storage: until you ask for deletion (see "Your rights"); there is no automatic deletion of inactive guests.',
        ],
      },
      {
        heading: 'Matches, rating and replays',
        body: [
          'For each match the server stores the map, the start and end times, the result, which guest or bot played each side, and the rating values of the guest (rating, deviation, volatility, number of rated matches). A replay file holds the commands and the course of the match; it contains no nickname, but it can be linked to a guest through the match record.',
          'Replays of rated matches can be opened by anyone who knows the match number. Other replays are available only to the two participants. Storage: until deletion on request.',
        ],
      },
      {
        heading: 'IP address and server logs',
        body: [
          'The server briefly uses your IP address to limit how many guests can be created from one address and how many password logins can be tried. For this the address is kept in the memory of the server process only (by default for at most one hour), it is never written to the database or to a file and is gone after a restart.',
          'The game server writes a technical log: time, HTTP method, path without query string and secret parts, status code, duration and a random request number. It contains no IP address, no token and no nickname.',
          'The web server (Caddy) writes no access log. Its operational log can contain an IP address in error messages (for example a failed TLS handshake). Logs are kept by the container runtime, rotated by size and overwritten; they are removed when the containers are replaced during a deployment. Maximum retention of logs with IP addresses: <LOG_RETENTION_DAYS> days (the operator confirms this value against the real server configuration).',
        ],
      },
      {
        heading: 'Data in your browser',
        body: [
          'The game saves two entries in the localStorage of your browser. No cookies are set.',
        ],
        items: [
          'sbf.guest: your nickname and your token, so that you stay the same guest on your next visit. Remove it with "Change nickname" in the menu or by clearing site data; the guest on the server is then no longer reachable from this browser.',
          'sbf.locale: the interface language you picked.',
          'sbf.sound: whether the sound switch in a match is on.',
          'sbf.hints.matches and sbf.hints.last: how many matches you played, to hide the key hints after the third (and the last match counted).',
        ],
      },
      {
        heading: 'Hosting and third parties',
        body: [
          'The site is hosted by <HOSTING_PROVIDER>, <HOSTING_LOCATION>. The provider processes technical connection data on our behalf; a data processing agreement is concluded: <CONFIRM_DPA>.',
          "The server obtains a TLS certificate from a certificate authority (Let's Encrypt); no visitor data is sent for this.",
          'No error-tracking service, analytics, advertising network, CDN or external font is used. If one is added later, this policy is updated first, and analytics will run only with your consent.',
        ],
      },
      {
        heading: 'Your rights',
        body: [
          'You have the right of access, rectification, erasure, restriction of processing, data portability and objection (Art. 15 to 21 GDPR), and the right to lodge a complaint with a supervisory authority: <SUPERVISORY_AUTHORITY>.',
          'To have your guest deleted, write to <EMAIL> and name your nickname. Because an account has no e-mail, we may ask you to show that the account is yours (for example a match played at an agreed time). On deletion the nickname and the token hash are replaced, the password hash and the rating are removed; the matches stay without a link to you.',
        ],
      },
      {
        heading: 'Status',
        body: ['Version of <DATE>. Changes to this policy are published on this page.'],
      },
    ],
  },
} as const satisfies LegalContent;
