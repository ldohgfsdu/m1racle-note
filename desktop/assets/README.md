# Windows runtime icon assets

The user selected the complete M1racle mother mark plus Note for every Windows icon size on 2026-10-16. This product instruction overrides the baseline small-size N policy for Windows runtime, taskbar, EXE and favicon assets.

Run `node desktop/scripts/windows-icons.cjs` from the project root. Since 0.1.14 it reads the full mother-mark and outlined Note paths from the approved `branding/m1racle-note/v1/svg/icon-512-{day,night}.svg`, composes a tighter Windows layout and renders each 16/24/32/48/64/128/256/512/1024px size directly from vectors. The mother mark occupies 87.5% of the width, Note 60%; sizes up to 64px receive a small optical stroke compensation. Generated SVGs document the exact paths and layout. The formal source files are unchanged. The seven ICO entries use these size-specific PNGs; `icon.png` and `icon-day.png` are 512px aliases.

`desktop/icons.mjs` uses a 64px intrinsic nativeImage base. A 16px base produced a 16px Windows large HICON despite its larger representations, so Windows enlarged a blurred source. The native regression reads the real window HICON, checks both themes against the 64px artwork and renders it with Windows DrawIconEx at 16/32/48px: `node desktop/tests/icons-native.mjs`. QA images go to a temporary directory.

The formal `branding/m1racle-note/v1` delivery remains unchanged, including its small-size N optical masters. Do not copy those small N files back over the Windows runtime assets. The master-symbol files are unchanged brand resources for the window identity.

The prior `output/icon-adoption-20261016/windows/full-master-override/` evidence documents 0.1.13, before this optical and HICON correction. A preview sheet or DrawIconEx capture is not a screenshot of the user's pinned taskbar.
