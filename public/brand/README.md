# Brand assets

Put these two files here. They are not committed by the build session because
the JAKIM Halal Malaysia logo is a certification mark, not a free asset.

| File | Used for | Size |
|---|---|---|
| `jakim-halal-logo.png` | Header logo, left of "HALAL EXECUTIVE" | 512 x 512, transparent background |
| `favicon.png` | Browser tab icon | 64 x 64 (same artwork) |

`halal-logo.svg` is a neutral placeholder drawn by the build session so the page
renders before the official files are dropped in. The header and favicon switch
to the PNGs automatically once they exist (the `<img>` falls back to the SVG on
a 404).

Legal note (Wan to confirm against the gazetted text): the Halal Malaysia logo is
controlled under the Trade Descriptions (Certification and Marking of Halal)
Order 2011, made under the Trade Descriptions Act 2011 (Act 730). Display of the
logo by a party that is not the certificate holder is what KPDN prosecutes under
paragraph 8 of the Order. A knowledge site is not a product, but the header use
should still be cleared with JAKIM Bahagian Hab Halal before the domain goes
live, or the header should carry the Halal Executive wordmark alone.
