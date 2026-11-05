# Website admin

The owner edits **clients, services, team, industries and section images** at
`https://www.sysmpl.com/admin/` with one shared password. No coding needed.

## How it works

- All editable content lives in `content/site.json`. Uploaded images go to `assets/img/uploads/`.
- `scripts/render.mjs` builds the parts of `index.html` and `careers.html` between
  `<!-- cms:… -->` markers. Everything else on the pages stays hand-written.
- The admin talks to a Netlify function, `netlify/functions/admin.mjs`. It checks the password
  (stored only as a PBKDF2 hash in Netlify Blobs) and, on **Save**, publishes a new Netlify
  deploy: the current site plus the rebuilt pages, the new `content/site.json` and new images.
  The live site updates within seconds. Every save is a deploy, so an earlier version can be
  restored from Netlify → Deploys → "Publish deploy". No GitHub is involved.

## Setup (once)

1. Netlify → avatar → **User settings → Applications → Personal access tokens → New access token**.
2. In this folder run `node scripts/netlify-admin-setup.mjs`. Paste the token and choose the
   admin password (both stay hidden). The token is saved as the site's `ADMIN_NETLIFY_TOKEN`
   setting.
3. Deploy once (below) so the function picks up the token.

## Change the password

- In the admin, click **Password** (top right). Everyone logged in is logged out.
- Forgot it? Run `node scripts/netlify-admin-setup.mjs --password-only` (needs a Netlify token).

## Deploying from this computer — always pull first

The owner's edits exist only on Netlify, so a deploy from this folder must pull them first:

    npm run deploy

It runs `scripts/pull.mjs` (downloads the live `content/site.json` and new images), rebuilds the
pages, copies the public files into `_site` and deploys that. Never deploy this folder without
pulling, or the owner's changes would be undone.

## Test on this computer

`node scripts/admin-server.mjs`, then open http://localhost:5181/admin/ (any password).
Saves write straight into these files and rebuild the pages.

## Security notes

- Use a strong password; wrong attempts are slowed down. Logins last 12 hours.
- The Netlify token can manage the whole Netlify account and is readable only by the site's
  functions. If it leaks, delete it in Netlify and run the setup again with a new one.
