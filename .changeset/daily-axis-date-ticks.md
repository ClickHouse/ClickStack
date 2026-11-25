---
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

fix: show the date on every x-axis tick of time charts at daily granularity or
coarser, instead of repeating the time (e.g. `00:00:00`) after the first tick.
When a daily bucket doesn't start at midnight in the display time zone, the tick
shows the date and time.
