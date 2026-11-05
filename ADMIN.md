# Website admin

The owner edits **clients, services, team, industries and section images** at
`https://www.sysmpl.com/admin/` with one shared password. No coding needed.
Everything — code, content, hosting — is on GitHub: repository
`adeebjnec-cyber/sysmatica-website`, published with GitHub Pages.

## How it works

- All editable content lives in `content/site.json`. Uploaded images go to `assets/img/uploads/`.
- `scripts/render.mjs` builds the parts of `index.html` and `careers.html` between
  `<!-- cms:… -->` markers. Everything else on the pages stays hand-written.
- The password is never stored. It unlocks `admin/config.json`, which holds a GitHub token
  (for this one repository) in encrypted form.
- **Save** commits the change to GitHub. The workflow in `.github/workflows/pages.yml` then
  runs `scripts/build.mjs` + `scripts/stage.mjs` and publishes `_site` to GitHub Pages.
  The live site updates in about 1–2 minutes. Every save is a commit, so any change can be
  seen and undone from the GitHub history.

## Setup (once, and whenever the token expires)

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token**: repository access *Only select repositories* → `sysmatica-website`;
   permissions → **Contents: Read and write**; nothing else.
2. In this folder run:

       node scripts/admin-setup.mjs --repo adeebjnec-cyber/sysmatica-website --branch main

   Paste the token and type the admin password twice (all hidden).
3. Commit and push `admin/config.json`.

## Change the password

In the admin, click **Password** (top right). The new password works once the site has
updated (1–2 minutes). Forgot it? Run the setup command above again.

## Editing from this computer

The owner's edits are commits on GitHub, so always `git pull` before changing files here,
then commit and `git push`. Pushing publishes the site.

## Test on this computer

`node scripts/admin-server.mjs`, then open http://localhost:5181/admin/. Without a GitHub
token in `admin/config.json`, saves write straight into these files.

## Security notes

- Use a strong password: `admin/config.json` is public and its safety depends on the password.
  The token inside can only edit this one repository's files.
- If the token leaks, delete it on GitHub and run the setup again with a new one.
