---
'@hyperdx/app': patch
---

feat: team settings now has a sidebar with one page per setting and a search
box that also finds individual settings, such as "Parallelize queries when
possible", and jumps to them. API keys and organization API keys share one page.
Old `?tab=` links redirect to the new pages.
