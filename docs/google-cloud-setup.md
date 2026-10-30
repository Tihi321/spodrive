# Google Cloud setup for Spodrive (new project)

These steps create a new Google Cloud project. At the end you will have the three values the app needs:

| Value | Env var | Where it comes from |
| --- | --- | --- |
| OAuth client ID | `VITE_GOOGLE_CLIENT_ID` | Step 5 |
| API key | `VITE_GOOGLE_API_KEY` | Step 6 |
| App ID (project number) | `VITE_GOOGLE_APP_ID` | Step 7 |
| OAuth client secret | `GOOGLE_CLIENT_SECRET` (Netlify site env, not GitHub) | Step 5 |

The client secret is optional but recommended: with it, the `/api/auth` sign-in helper keeps you signed in. Without it, Google access lasts an hour and the app asks you to reconnect (and music that isn't downloaded stops when that happens with the screen off).

You also publish the app (step 8) so any Google account can sign in without being a test user.

Origins used below (swap them for yours if they differ):
- Local dev: `http://localhost:5173`
- Production: `https://spodrive.tihomir-selak.from.hr`

---

## 1. Create the project

1. Open <https://console.cloud.google.com/> and sign in with the Google account that will own the app.
2. Click the project picker in the top bar, then **New project**.
3. Name it (for example `spodrive`), leave the organization as is (or *No organization*), and click **Create**.
4. When it's ready, make sure the new project is selected in the top bar. Every step below applies to the selected project.

## 2. Enable the APIs

1. Go to **APIs & Services → Library**.
2. Search for **Google Drive API**, open it and click **Enable**.
3. Go back to the Library, search for **Google Picker API**, open it and click **Enable**.

## 3. Configure the consent screen (Google Auth Platform)

Go to **APIs & Services → OAuth consent screen**. In the current console this opens **Google Auth Platform**. If you see **Get started**, click it and fill in the wizard:

1. **App information:** app name `Spodrive` and a user support email (your address).
2. **Audience:** **External**.
3. **Contact information:** your email.
4. Agree to the user data policy and click **Create**.

Then fill in the remaining pages in the left menu:

**Branding**
- **App name**, **User support email**, and optionally a logo. A logo can trigger brand verification, so leaving it out is simplest.
- **Application home page:** `https://spodrive.tihomir-selak.from.hr`
- **Application privacy policy link:** `https://spodrive.tihomir-selak.from.hr/privacy.html` (this is served from `apps/web/public/privacy.html`)
- **Authorized domains:** `tihomir-selak.from.hr`
- **Developer contact information:** your email.
- Click **Save**.

**Data access**
1. Click **Add or remove scopes**.
2. Find and tick `https://www.googleapis.com/auth/drive.file` (*See, edit, create and delete only the specific Google Drive files you use with this app*). If it isn't in the list, paste it into **Manually add scopes**.
3. Click **Update**, then **Save**.
4. It should be listed under **Your non-sensitive scopes**. Don't add any other Drive scope: `drive`, `drive.readonly` and similar are restricted and need a paid security assessment.

## 4. (Optional) Test users while you try it out

While the app is still in **Testing** (the default), only listed accounts can sign in:

1. Go to **Audience → Test users → Add users**.
2. Add the Google accounts you want to test with.

You can skip this if you publish right away (step 8).

## 5. Create the OAuth client ID → `VITE_GOOGLE_CLIENT_ID`

1. Go to **Clients** in Google Auth Platform (or **APIs & Services → Credentials → Create credentials → OAuth client ID**).
2. Click **Create client**.
3. **Application type:** **Web application**. **Name:** `Spodrive web`.
4. **Authorized JavaScript origins:** add both. Use scheme and host only, with no path and no trailing slash:
   - `http://localhost:5173`
   - `https://spodrive.tihomir-selak.from.hr`
5. **Authorized redirect URIs:** leave empty. Sign-in runs in a Google popup that hands the result back to the page, so there is no redirect.
6. Click **Create** and copy the **Client ID** (`xxxxxxxx.apps.googleusercontent.com`).
   - No Desktop client is needed anymore.
7. Copy the **Client secret** as well (on an existing client: open it under **Clients**; add a secret if none is shown). Put it **only** in the Netlify site environment, never in a `VITE_*` variable (those end up in the public JavaScript):
   - Netlify → **Site configuration → Environment variables → Add a variable**
   - `GOOGLE_CLIENT_SECRET` = the secret
   - `GOOGLE_CLIENT_ID` = the client ID from step 6
   - Redeploy. `https://<your site>/api/auth/status` should then answer `{"enabled":true}`.
   - Already signed in on a device? Use **Settings → Stay signed in** there once (or just tap **Reconnect** next time it shows).

## 6. Create the API key → `VITE_GOOGLE_API_KEY`

The Picker needs a browser API key. It will be visible in the page source, which is normal. The restrictions below are what protect it.

1. Go to **APIs & Services → Credentials → Create credentials → API key**.
2. Copy the key, then click **Edit API key** (or open it from the list).
3. **Name:** `Spodrive Picker`.
4. **Application restrictions:** choose **Websites** and add:
   - `http://localhost:5173/*`
   - `https://spodrive.tihomir-selak.from.hr/*`
5. **API restrictions:** choose **Restrict key** and tick only **Google Picker API**.
6. Click **Save**. Restrictions can take a few minutes to take effect.

## 7. Get the project number → `VITE_GOOGLE_APP_ID`

1. Go to **IAM & Admin → Settings** (or the project **Dashboard → Project info** card).
2. Copy the **Project number**. It's all digits, like `123456789012`. Use the number, not the project ID string.

## 8. Publish the app (any Google account can sign in)

1. Go to **Audience** in Google Auth Platform.
2. Under **Publishing status: Testing**, click **Publish app** and confirm.
3. The status changes to **In production**.

What to expect:
- **No review:** the only scope is `drive.file`, which is non-sensitive. Google doesn't require sensitive-scope verification or a CASA security audit.
- **Possible brand verification:** the console may still ask for it, to show your app name and logo on the consent screen. If it does, the **Verification center** lists what's missing. Usually that's proving you own the home page domain in [Google Search Console](https://search.google.com/search-console) with the same Google account, and having the privacy policy page live. This is a short form, not a security review.
- **Before verification finishes,** users may see the project's domain instead of the app name on the consent screen. Sign-in still works.

## 9. Put the values into the app

**Local dev** (`apps/web/.env`, copied from `apps/web/.env.example`):

```env
VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=AIza...
VITE_GOOGLE_APP_ID=123456789012
VITE_BASE=/
```

Then run `npm run dev` and open <http://localhost:5173>.

**Production deploy** (GitHub → repo **Settings → Secrets and variables → Actions → Variables**):

| Name | Value |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | the client ID from step 5 |
| `VITE_GOOGLE_API_KEY` | the API key from step 6 |
| `VITE_GOOGLE_APP_ID` | the project number from step 7 |

`NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` stay as secrets, as before. CI skips the deploy with a warning until all of them are set.

## 10. Check it works

1. Open the app in a private window and sign in with a Google account that is **not** a test user. This only works after step 8.
2. The consent screen should ask only for access to *specific Google Drive files you use with this app*.
3. Click **Add music from Google Drive**. The Picker should open and list your audio files and folders.
   - The **Upload** tab uploads songs from this device into `Spodrive/Music` and adds them to the library.
   - If the Picker shows an error about the developer key or origin, recheck the API key restrictions (step 6) and wait a few minutes.
4. Click **Add folders**, choose a folder, then select the songs in the second Picker that opens inside it. Google only gives the app the songs you select, not everything in a picked folder. (Picking a folder with **Add music from Google Drive** adds only the folder, and the app tells you when it found no songs.)
5. Check that a `Spodrive` folder with `library.json` appears in your Drive, and that tracks play and seek.

## 11. TV / Echo Show: sign in with a code (optional)

Skip this if you only use Spodrive on phones and computers. Echo Show's Silk browser can't use the normal Google popup, so Spodrive offers **Sign in with a code** (OAuth device flow), which needs a second OAuth client and a small Netlify function that holds its secret.

1. In the **same project**, go to **Clients → Create client**. **Application type:** **TVs and Limited Input devices**. **Name:** `Spodrive TV`. Click **Create**.
2. Copy the **Client ID** and **Client secret**. Keep the secret out of git and out of the web build.
3. In Netlify, open the site → **Site configuration → Environment variables → Add a variable**, and set both with the **Functions** scope:

   | Name | Value |
   | --- | --- |
   | `GOOGLE_TV_CLIENT_ID` | the TV client ID |
   | `GOOGLE_TV_CLIENT_SECRET` | the TV client secret |

4. Redeploy (the GitHub Actions deploy publishes `netlify/functions`). Environment variable changes only apply to new deploys.
5. Scope: the device flow only allows `drive.file`, which is what Spodrive already uses. The *Read whole folders* option (`drive.readonly`) isn't available on the Echo.

Locally, put the two variables in your shell or a `.env` file at the repo root and run `npx netlify dev`, then open <http://localhost:8888/?device=1>.

**Smoke test with curl** (replace the host with your site, or `http://localhost:8888` under `netlify dev`). The function only accepts requests whose `Origin` is the site itself or localhost:

```sh
HOST=https://spodrive.tihomir-selak.from.hr
curl -s -X POST "$HOST/api/device-auth" -H "Origin: $HOST" -H "Content-Type: application/json" -d '{"action":"start"}'
# -> {"device_code":"...","user_code":"ABCD-EFGH","verification_url":"https://www.google.com/device","expires_in":1800,"interval":5}
# Open the verification_url, enter the user_code and approve, then poll with the device_code:
curl -s -X POST "$HOST/api/device-auth" -H "Origin: $HOST" -H "Content-Type: application/json" -d '{"action":"poll","device_code":"<device_code>"}'
# -> {"error":"authorization_pending"} until you approve, then {"access_token":"...","expires_in":3599,"refresh_token":"...","scope":"https://www.googleapis.com/auth/drive.file","token_type":"Bearer"}
```

A `501` with `device_signin_not_configured` means the environment variables are missing or the site wasn't redeployed after setting them.

Note: `drive.file` access belongs to the project, so the TV client should see the files you picked through the web client. Confirm this on the real device: songs added from a phone must show up on the Echo.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Error 400: redirect_uri_mismatch` / `origin_mismatch` | The page origin isn't in the client's **Authorized JavaScript origins** (step 5). It must match exactly: scheme, host and port, no trailing slash. |
| `Access blocked: app has not completed the Google verification process` | The app is still in **Testing** and the account isn't a test user. Publish (step 8) or add the account (step 4). |
| Picker: *The API developer key is invalid* | Wrong key, the Picker API isn't enabled (step 2), or the key's website restriction doesn't include the current origin (step 6). |
| Picker opens but is empty | The view only shows audio files and folders. Check that the files have an audio MIME type in Drive (Drive shows them as audio). |
| Code screen says sign-in with a code isn't set up (HTTP 501) | `GOOGLE_TV_CLIENT_ID` / `GOOGLE_TV_CLIENT_SECRET` are missing in Netlify, or the site wasn't redeployed after adding them (step 11). |
| Code sign-in: `invalid_client` / `unauthorized_client` | The client type isn't *TVs and Limited Input devices*, or the ID and secret don't belong together. |
| "Google Picker is not configured" toast | `VITE_GOOGLE_API_KEY` or `VITE_GOOGLE_APP_ID` is missing from the build env (step 9). |
