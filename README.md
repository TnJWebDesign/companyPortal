# Inventory Tracker

A mobile-friendly inventory tracker that runs entirely in the browser and syncs in real time through Firebase Firestore. Plain HTML, CSS and JavaScript: no Node.js, no npm, no build step. Host it free on GitHub Pages.

**Features**

- Real-time sync across phones, tablets and computers, with a live status pill (Synced / Syncing… / Offline)
- Password lock screen (SHA-256 hash, no plain-text password in the code)
- Add, edit and delete items: name, SKU, category, quantity, low-stock threshold, notes
- `+1` / `−1` buttons on every item (never below zero), with a `lastUpdated` time recorded on each quantity change
- Search by name or SKU, category filter, "Low stock only" toggle
- Summary bar: total items, total units, low-stock count
- Works offline: changes are saved on the device and upload when the connection returns

**Files**

| File | Purpose |
| --- | --- |
| `index.html` | Page structure, lock screen, dialogs |
| `styles.css` | Responsive styling (cards on phones, table on desktop) |
| `app.js` | Firebase config, password check, all app logic |
| `README.md` | This guide |

---

## 1. Create a free Firebase project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. Click **Create a project** (or **Add project**), name it (for example `my-inventory`), and finish the wizard. You can turn Google Analytics off.
3. In the left menu open **Build → Firestore Database** and click **Create database**.
4. Pick a location close to you, then choose **Start in production mode** and click **Create**.
5. Open the **Rules** tab, paste the rules from [section 5](#5-firestore-security-rules), and click **Publish**.
6. Click the gear icon next to **Project Overview** → **Project settings**.
7. Under **Your apps**, click the web icon `</>`, give the app a nickname, and click **Register app** (skip Firebase Hosting).
8. Copy the `firebaseConfig` values shown. You will paste them into `app.js` next.

The free Spark plan is plenty for a personal or small-shop inventory.

## 2. Add your Firebase config to `app.js`

Open `app.js` and replace the placeholders in `FIREBASE_CONFIG` at the top:

```js
const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "my-inventory.firebaseapp.com",
  projectId: "my-inventory",
  storageBucket: "my-inventory.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef",
};
```

These values identify your project; they are not secrets. Your **security rules** are what protect the data (see sections 5 and 7).

## 3. Choose your password

The app ships with the password `changeme` so you can test it. Change it before real use.

`app.js` stores only the SHA-256 hash of the password. To make a hash:

**Option A: browser console (easiest)**

1. Open any web page (this app's page works), press `F12` (or right-click → Inspect) and open the **Console** tab.
2. Paste this, replacing `my new password`, and press Enter:

```js
crypto.subtle.digest("SHA-256", new TextEncoder().encode("my new password"))
  .then(buf => console.log([...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("")));
```

3. Copy the 64-character result.

**Option B: from this app's page.** The app exposes a helper, so on the lock screen's page you can run:

```js
hashPassword("my new password")
```

**Option C: terminal**

```bash
printf 'my new password' | shasum -a 256      # macOS
printf 'my new password' | sha256sum          # Linux
```

Paste the hash into `app.js`:

```js
const PASSWORD_HASH = "paste-your-64-character-hash-here";
```

Until you change it, a yellow reminder banner appears at the top of the app.

> The password gate runs in the browser. It keeps casual visitors out of the interface, but it does **not** stop someone who knows how to call your Firestore database directly. For real protection, use the Firebase Auth option in [section 7](#7-bonus-server-enforced-protection-with-firebase-auth).

## 4. Test it on your computer

Browsers block ES modules and the Web Crypto API on plain `file://` pages, so serve the folder locally:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Unlock with your password, add an item, and open the page on a second device or browser tab to watch it sync.

## 5. Firestore security rules

In **Firestore Database → Rules**, use one of these.

**Password-gate mode** (default, `USE_FIREBASE_AUTH = false`). Anyone who has your Firebase config can read and write, so these rules at least validate the data:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /inventory/{itemId} {
      allow read, delete: if true;
      allow create, update: if request.resource.data.name is string
                            && request.resource.data.name.size() > 0
                            && request.resource.data.name.size() <= 120
                            && request.resource.data.quantity is int
                            && request.resource.data.quantity >= 0
                            && request.resource.data.threshold is int
                            && request.resource.data.threshold >= 0;
    }
  }
}
```

**Auth mode** (`USE_FIREBASE_AUTH = true`). Only the signed-in user can touch the data:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /inventory/{itemId} {
      allow read, delete: if request.auth != null;
      allow create, update: if request.auth != null
                            && request.resource.data.name is string
                            && request.resource.data.name.size() > 0
                            && request.resource.data.name.size() <= 120
                            && request.resource.data.quantity is int
                            && request.resource.data.quantity >= 0
                            && request.resource.data.threshold is int
                            && request.resource.data.threshold >= 0;
    }
  }
}
```

If you rename `COLLECTION` in `app.js`, change `inventory` in the rules to match.

## 6. Deploy to GitHub Pages

1. Create a new repository on GitHub (public or private; Pages on private repos needs a paid plan).
2. Upload `index.html`, `styles.css`, `app.js` and `README.md` to the repository root. Use **Add file → Upload files**, or with git:

   ```bash
   git init
   git add .
   git commit -m "Inventory tracker"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```

3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose branch `main` and folder `/ (root)`, then **Save**.
5. After a minute or two the site is live at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.
6. Open it on your phone and use **Add to Home Screen** for an app-like shortcut.

**Optional hardening:** in the [Google Cloud console](https://console.cloud.google.com/apis/credentials), open your project's **Browser key** and add an HTTP referrer restriction for `https://YOUR-USERNAME.github.io/*` (and `http://localhost:8000/*` for testing). This stops other websites from using your API key.

## 7. Bonus: server-enforced protection with Firebase Auth

The built-in lock screen is a client-side gate. To have Firebase itself reject strangers, use Firebase Auth with a single shared account. The password you type on the lock screen becomes that account's password.

1. In the Firebase console open **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Email/Password**.
3. Open the **Users** tab and click **Add user**. Use an email such as `inventory@example.com` (it doesn't need to be a real mailbox) and a password of at least 6 characters.
4. In `app.js` set:

   ```js
   const USE_FIREBASE_AUTH = true;
   const AUTH_EMAIL = "inventory@example.com";   // the email you just created
   ```

5. Switch your Firestore rules to the **Auth mode** version in section 5 and publish them.
6. Commit and push. The lock screen now signs in to Firebase. `PASSWORD_HASH` is ignored in this mode.
7. If you see `auth/unauthorized-domain`, go to **Authentication → Settings → Authorized domains** and add `YOUR-USERNAME.github.io`.

Also turn off sign-ups for strangers: in Email/Password mode only users you create in the console can sign in unless your code calls `createUserWithEmailAndPassword`, which this app never does.

## How the data is stored

Each item is one document in the `inventory` collection:

```
name         string
sku          string
category     string
quantity     number (whole, 0 or more)
threshold    number (low-stock level)
notes        string
createdAt    timestamp
lastUpdated  timestamp (set whenever quantity changes)
```

An item is **Low stock** when `quantity <= threshold` and **Out of stock** when `quantity = 0`. The summary's low-stock count includes out-of-stock items, and "Low stock only" shows both.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Firebase isn't set up yet" | `FIREBASE_CONFIG` still has `YOUR_...` placeholders. |
| Sync pill says "Sync error" and the list shows a permission message | Publish the security rules from section 5. |
| "Firestore isn't ready" | You haven't created the Firestore database (section 1, step 3). |
| Blank page or lock screen doesn't respond locally | Serve over `http://localhost` (section 4), not `file://`. |
| Wrong password every time | Re-generate the hash; make sure no spaces or line breaks were pasted into `PASSWORD_HASH`. |
| Pill stays on "Connecting…" | The device has no connection to Firebase. Changes still save locally and upload later. |
| Two devices change the same item at once | The last change wins. Quantity is saved as a whole number and never drops below zero. |

## Notes

- Firestore's free tier limits daily reads, writes and storage. A personal inventory rarely gets close, and the app reads each item once and then receives only changes.
- Offline caching uses the browser's IndexedDB. If a browser blocks it (some private windows), the app still works while online.
