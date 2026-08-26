# Daphne Menu Bar

A read-only native macOS companion for Puppy Companion. The menu-bar title
shows the latest shared event and elapsed time; its panel shows the latest
timestamp and five recent events. It refreshes on launch, on demand, and every
60 seconds.

## Build and connect

```bash
./build-app.sh
open "dist/Daphne Menu Bar.app"
```

On a paired phone, tap **Add phone**, send the private link to the Mac, copy it,
then choose **Paste and connect** in the menu-bar panel. Anonymous Supabase
credentials, the household identifier, and the private capability are stored in
the macOS Keychain. The app is read-only and all database access remains subject
to the existing household RLS policies.

Use the **Launch at login** switch after moving the bundle to `/Applications`.
