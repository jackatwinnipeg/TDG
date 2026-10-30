# pdf.js 6.4.299

Reads the text of PDF delivery lists, and in the app draws the pages of a scanned PDF as
pictures for text recognition (ROUTE_PROPOSAL.md 3.2.1, decision 36). Loaded only when a PDF
is chosen, by `js/list_read.js`; nothing is fetched from the internet.

- Source: npm package `pdfjs-dist` 6.4.299 (Mozilla, released 2026-10-03),
  https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz
  (sha1 4a46f5146ac6505564c1a5d472900be4df8bf628, matches the registry), downloaded 2026-10-25.
  Files unchanged, from `legacy/build` (the build for older browsers and Android WebViews) and `wasm`.
- License: Apache-2.0, see `LICENSE`. The picture decoders in `wasm/` (JBIG2, JPEG 2000, used for
  scanned PDFs) carry their own licenses next to them (BSD-style, Apache-2.0).

| File | Bytes | SHA-256 |
|---|---|---|
| pdf.min.mjs | 523774 | bccc24ea711db8e44503629519904a5292d73b9daaa214bbe7cdcc282b0f4259 |
| pdf.worker.min.mjs | 1321307 | 145d2dd3ab0c86151011dba95acfa2d5336e2accd59388ea43dbee0efddaaec6 |
| LICENSE | 10174 | 0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594 |
| wasm/jbig2.wasm | 103671 | 466f45c2a61a698152fb5400c27e56ff2ceb73dcb71fde3fc366a502308eaab0 |
| wasm/openjpeg.wasm | 251131 | 95e5002597af0824004aa57b1900fe019715db389e37640b1e58395e42f00cc5 |
| wasm/LICENSE_JBIG2 | 12862 | 9e66b7f1b934a28b37f3bc4dac97915de1674271e79a0a88182a18ed9731b4d1 |
| wasm/LICENSE_OPENJPEG | 2112 | a6af136f3e15038a666b61f376612a07d9a4e48cb7c01adbf3e33b3f14ab49b6 |
| wasm/LICENSE_PDFJS_JBIG2 | 555 | aad3cce09842e00e9e11ad5e8fef8cc02fbc3a3768fe2f007443b9cee37aaee5 |
| wasm/LICENSE_PDFJS_OPENJPEG | 1285 | 717fc62da03292dbb4dd0c8280bd4ce7bb8550dcf31d772bc93455fb50313425 |
