# Typora Theme Targets

Updated: 2026-06-13

Source of discovery: Typora Theme Gallery at `https://theme.typora.io/`.

## Pilot Themes

These five themes are the first import batch. Their source repositories and raw CSS files have been verified before integration.

| Theme | Import ID | Status | Verified CSS Source | Notes |
| --- | --- | --- | --- | --- |
| Konayuki | `typora-konayuki` | installed pilot | `https://raw.githubusercontent.com/aerandirsf/Konayuki/main/konayuki-light.css` | User priority; light ocean/sun feeling. |
| Folio | `typora-folio` | installed pilot | `https://raw.githubusercontent.com/liyoulu/typora-folio-theme/main/folio.css` | Strong editorial layout. |
| Zeus | `typora-zeus` | installed pilot | `https://raw.githubusercontent.com/zmtsikriteas/zeus-typora-theme/main/zeus.css` | Dashed/structured styling. |
| Bonne nouvelle | `typora-bonne-nouvelle` | installed pilot | `https://raw.githubusercontent.com/senges/typora-bonne-nouvelle/main/bonne-nouvelle.css` | Typewriter writing feeling. |
| Flexoki Light | `typora-flexoki-light` | installed pilot | `https://raw.githubusercontent.com/guidovicino/flexoki-typora/main/flexoki-light.css` | Soft daily writing baseline. |

## Full Target List

| Theme | Priority | Source Status | Notes |
| --- | --- | --- | --- |
| Inkwell | later | needs verification | User liked. |
| Salamander | later | needs verification | Interesting design; colors may need adjustment. |
| Maodie | later | needs verification | Borrow bullet-marker idea. |
| Crisp | later | needs verification | Good spacing. |
| Folio | installed pilot | verified | Pilot. |
| Swiss | later | needs verification | Sharp box design. |
| Blue Topaz | later | needs verification | Colorful reference. |
| LaTeX Typora | later | needs verification | Good academic style. |
| Paperglow Theme | later | needs verification | Rounded/compact feeling. |
| Gruvbox | later | needs verification | Dark theme candidate. |
| Zeus | installed pilot | verified | Pilot. |
| Bit Clean | later | needs verification | Blue style reference. |
| Bonne nouvelle | installed pilot | verified | Pilot. |
| Print | later | needs verification | Print/export reference. |
| Konayuki | installed pilot | verified | Pilot. |
| Neon | later | needs verification | Highly styled; needs polish check. |
| Everforest | later | needs verification | Pleasant palette. |
| Screenplay | later | needs verification | Typewriter/screenplay style. |
| Flexoki Light | installed pilot | verified | Pilot. |
| mdmdt | later | needs verification | Light purple, breathable. |
| Ravel | later | needs verification | Pale/elegant. |
| Ceylon | later | needs verification | Image treatment reference. |
| Blackout | later | needs verification | Quote block reference. |
| Whitelines | later | needs verification | Printed style reference. |
| LCARS | later | needs verification | Highly stylized compatibility stress test. |
| Valve | later | needs verification | Gray-green palette. |
| Alise | later | needs verification | Distinctive color reference. |
| Torillic | later | needs verification | Medieval style reference. |
| Chocolate Box | later | needs verification | Strong, vivid style. |
| Eloquent | later | needs verification | Distinctive code treatment. |
| Inside | later | needs verification | Inline image behavior reference. |
| Law | later | needs verification | Clear document style. |
| Minimalism | later | needs verification | Clean and legible. |

## Import Rules

- Verify each theme from the Typora Theme Gallery page before downloading.
- Prefer raw CSS from the linked upstream repository.
- Keep raw CSS under `src/styles/typora/raw/`.
- Generate scoped CSS under `src/styles/typora/generated/`.
- Do not let raw Typora CSS style the app shell directly.
- Map Typora TOC selectors to the right-side outline instead of adding inline TOC blocks.
