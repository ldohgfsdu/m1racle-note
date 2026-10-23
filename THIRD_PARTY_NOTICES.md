# Third-party software

- Atomic Editor 0.6.2, MIT, Copyright Kenny Bergquist. https://github.com/kenforthewin/atomic-editor
- CodeMirror 6, MIT. https://github.com/codemirror
- Lezer, MIT. https://github.com/lezer-parser
- React / React DOM, MIT. https://github.com/facebook/react
- AndroidX, Apache-2.0. https://developer.android.com/jetpack/androidx
- Electron, MIT, including Chromium and Node third-party notices supplied in the Windows distribution. https://github.com/electron/electron
- CodeMirror language-data and language packages, MIT. https://github.com/codemirror/language-data
- Backdrop 2.0.0 (`io.github.kyant0:backdrop`), Apache-2.0, Copyright 2025 Kyant. https://github.com/Kyant0/AndroidLiquidGlass/tree/2.0.0 — license text: `licenses/backdrop-Apache-2.0.txt`.
- Inter font used by the brand source assets, SIL Open Font License 1.1. License and attribution are retained in `branding/m1racle-note/v1/fonts/OFL.txt`. https://github.com/rsms/inter
- Gradle Wrapper, Apache-2.0. The wrapper JAR is included to bootstrap the Android build; Gradle itself and Android build dependencies are downloaded separately. https://github.com/gradle/gradle

The root MIT license applies to M1racle Note's original source, not to a relicensing of these dependencies. Electron's distribution contains additional Chromium, Node.js and media-codec license notices; preserve `LICENSE` and `LICENSES.chromium.html` when distributing that runtime. In particular, do not describe the entire bundled runtime as MIT-only.

The Windows package includes npm production dependency license texts under `resources/app.asar/licenses/` and the Electron runtime notices alongside the executable.

Full Atomic Editor license is included in `licenses/atomic-editor-MIT.txt`. npm dependency packages retain their own license files. The Windows renderer applies a hash-checked build adapter (`desktop/renderer/editor-policy.mjs`) to Atomic 0.6.2: document mode keeps syntax collapsed during editing and supplies CodeMirror atomic ranges for hidden tokens. The npm package files and Android bundle are unchanged by this adapter.

The Android bundle includes full license texts for all production npm dependencies, including transitive packages (Lezer grammars, scheduler, style-mod, crelt, w3c-keyname and find-cluster-break), under `assets/editor/licenses/`.
