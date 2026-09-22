// Asset policy for the DeeVid study replica.
//
// Original media (cdn2.deevid.ai webp thumbs, DeeVid logo/OG files) is
// intentionally NOT bundled: it belongs to deevid.ai and this repo is a
// study-only front-end replica. Components use gradient placeholders +
// Lucide glyphs instead.
//
// This script only probes reachability of the documented hosts and exits 0
// without writing to public/. Run: node scripts/download-assets-deevid.mjs

const probes = [
  "https://deevid.ai/favicon.ico",
  "https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width=320/user-image/v2_1776745018720-464558345.png",
];

for (const url of probes) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    console.log(`${res.status} ${url}`);
  } catch (err) {
    console.log(`UNREACHABLE ${url} (${err.cause?.code ?? err.message})`);
  }
}
console.log("policy: no original media bundled (see ARTIFACT_MANIFEST.md).");
