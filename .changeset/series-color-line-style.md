---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
---

feat: per-series color and line style on line and bar charts

The palette button on each series row, previously shown only for table tiles,
now also appears on line, stacked line, and stacked bar tiles. Line series can
pick a color and a solid, dashed, or dotted line; stacked bar series pick a
color. Colors work on series without an alias. The button is hidden when the
chart has a group by, is a ratio, or hides its formula operands, since a select
item no longer maps to one drawn series there.
