# Plug-in layers

A plug-in is one JavaScript module in this folder that adds a layer to the atlas without touching the app's code.

- **Turn one on:** add `?plugins=daylength` to the app's address (several: `?plugins=a,b`), or list the names in `app/config.json` as `"plugins": ["daylength"]`. Only names of files in this folder are accepted (lower-case letters, digits and hyphens).
- **Write one:** `export default function (api) { return layer; }` (or export the layer object itself). The layer has the same shape as the built-in ones in `js/layers.js`: `id` (lower-case letters and digits), `group` (`live`, `space`, `science`, `infra`, `geo`, `cams`, `places`, `civic`), `label`, `swatch` (`#rrggbb`), `sources` (keys of `js/sources.js`), `load(options, ctx)`, `channels(data, ctx)` returning `{ points, particles, rings, … }`, and `learn: { what, how, try, refs }`. Optional: `describe`, `count`, `options`, `panel`, `stop`, `refresh`, `viewDependent`, `timeDriven`.
- **New data sources:** a plug-in may `export const sources = { key: { name, url, license, role } }`; they are added to the About list. For a source that ships with the atlas, also add it to `js/sources.js` and `tools/build-references.py` (APA 7th edition).
- **Checks:** the app checks every plug-in with `validateLayer()` in `js/registry.js` and refuses it, with a message, when something is missing. About → Layer manifest lists every layer, its sources and licences, and each plug-in's state.

`daylength.js` is a complete example.
