---
'@hyperdx/app': patch
---

fix: make the side nav's user menu reachable from the keyboard. Its trigger was
a plain <div>, so Tab skipped it and Enter and Space did nothing: keyboard users
could not open User preferences or Log out. It is now a <button>, named with the
user's name when the nav is collapsed to the avatar, with no visual change.
