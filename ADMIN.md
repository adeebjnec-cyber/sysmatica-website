# Website admin

The owner edits **clients, services, team, industries and section images** at
`https://www.sysmpl.com/admin/` with one shared password. No coding needed.

## How it works

- All editable content lives in `content/site.json`. Uploaded images go to `assets/img/uploads/`.
- `node scripts/build.mjs` rebuilds the parts of `index.html` and `careers.html` that sit between
  `<!-- cms:… -->` markers. Everything else on the pages stays hand-written.
- The password is never stored. It unlocks `admin/config.json`, which holds the GitHub
  connection details in encrypted form.
- When the owner clicks **Save**, the admin saves the change to the GitHub repository.
  Netlify (or GitHub Pages) then runs the build and the live site updates in about 1–2 minutes.

## 1. Set the password (needed before the admin can be used)

```
node scripts/admin-setup.mjs
```

The script asks for the password twice and needs at least 10 characters. A short sentence
works well. Run the same command again any time to change the password.

## 2. Test on this computer

```
node scripts/admin-server.mjs
```

Open http://localhost:5181/admin/ and log in. Saves write straight into these files and
rebuild the pages.

## 3. Connect saving to GitHub (live site)

1. Put this folder in a GitHub repository, for example `sysmatica/website`, branch `main`.
2. On GitHub, go to **Settings → Developer settings → Fine-grained tokens** and create a token:
   - Repository access: only that repository
   - Permissions: **Contents: Read and write** (nothing else)
   - Expiry: as long as you're comfortable with. When it expires, create a new token and
     run step 3 again.
3. Run:
   ```
   node scripts/admin-setup.mjs --repo OWNER/REPO --branch main
   ```
   It asks for the token (paste it; it stays hidden) and the admin password.
   ```
   ```
   Commit the new `admin/config.json`.
4. Hosting:
   - **Netlify:** link the site to the repository. `netlify.toml` already runs the build.
   - **GitHub Pages:** add a workflow that runs `node scripts/build.mjs` and then publishes
     the folder.

## Security notes

- Use a strong password. `admin/config.json` is public, and its strength depends on the
  password. The token inside it can only edit this one repository's files.
- Every save is a Git commit, so any change can be seen and undone from the GitHub history.
