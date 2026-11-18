---
'@hyperdx/app': patch
---

fix: keep the team switcher and user preferences reachable in the mobile app
nav. The app shell and nav were sized with `100vh`, which on mobile browsers
includes the area behind the retractable toolbar, so the bottom of the nav sat
off screen with no way to scroll to it. They now size to the small viewport.
