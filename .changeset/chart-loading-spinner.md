---
'@hyperdx/app': patch
---

fix: show a neutral spinner while charts load

Chart tiles now show a spinner with "Loading Chart Data..." while a query is in
flight, including when the previous result was empty. Before, they kept showing
"No data found within time range." until the new query finished. Loaders now
default to a neutral gray instead of yellow.
