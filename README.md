# Harbor Log

Harbor Log is a local-first journal for difficult moments, mood patterns, places, tags, and people.

The app code can be public, but journal entries stay private in each person's own browser by default. Optional cloud backup is personal: each user connects their own Google Drive and the app stores a hidden backup file in that user's Drive app-data folder.

## What is included

- A bookshelf and filing drawer view for browsing entries.
- Mood, intensity, tags, people, date/time, and location fields.
- IndexedDB local storage in the browser.
- JSON export and import.
- Optional Google Drive backup using the hidden appDataFolder.
- Charts for mood over time, average mood by location, and tag relationships.
- Offline app caching when served from localhost or HTTPS.

## Privacy model

- GitHub stores only the app code.
- Journal entries are saved locally in each user's browser.
- Export and import use JSON files controlled by the user.
- Google Drive sync is optional and uses that user's private Drive app data.
- No shared server database is required.

## Best route

Use GitHub for the app code and GitHub Pages hosting. Do not use GitHub as the private journal-data store. The safer default is app code in GitHub, journal data in browser storage, user-controlled JSON exports, and optional Google Drive backup.

## Run locally

For the core journal, open index.html.

For location, install/offline support, and Google Drive backup, run a local web server from this folder:

python -m http.server 4173

Then open:

http://localhost:4173

## Google Drive setup

Drive sync needs a Google OAuth web client ID.

1. Open Google Cloud Console.
2. Create or select a project.
3. Enable the Google Drive API.
4. Configure the OAuth consent screen.
5. Create an OAuth client ID for a web application.
6. Add authorized JavaScript origins such as http://localhost:4173 and your future GitHub Pages origin.
7. In Harbor Log, open Backup, paste the client ID, and save settings.

The app requests only this scope:

https://www.googleapis.com/auth/drive.appdata

The backup file is named harbor-log-backup.json and is stored in Google Drive's app data folder for the signed-in user.

## GitHub Pages

The repository is set up for GitHub Pages because the app is plain HTML, CSS,
and JavaScript.

1. Open `https://github.com/Dclaw35/Harbor-Log/settings/pages`.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Set the branch to `main` and the folder to `/ (root)`.
4. Save.

After GitHub finishes publishing, the app should be available at:

```text
https://dclaw35.github.io/Harbor-Log/
```

Use that published URL as an authorized JavaScript origin in Google Cloud if
you enable Google Drive backup.

## Privacy notes

The app does not send entries anywhere unless you use Drive backup or export a file. Location is only added when you press the location button and approve browser permission. JSON exports contain journal text, tags, people, and location notes, so keep them somewhere private.
