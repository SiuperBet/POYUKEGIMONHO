# POYUKEGIMONHO Mobile

Companion app nativa dello stesso prodotto web.

- Mobile: scanner, camera, torcia, acquisizione automatica/manuale e riconoscimento.
- Web: catalogo, collection, market, storico e revisione.
- Shared: Card / Printing / Variant e pipeline di recognition, condition e pricing.

Stack: React Native + Expo SDK 54 + `expo-camera`.

## Scanner

Lo scanner mobile usa `CameraView` con rilevamento geometrico dei 4 lati e 4 angoli, stabilizzazione, auto-capture opzionale, correzione prospettica a 4 punti, quality gate e OCR a zone fisse. Il riconoscimento usa catalogo locale quando disponibile e fallback mirato al catalogo remoto, con supporto Pokémon multilingua e conferma delle corrispondenze ambigue.

Per le API camera native viene usato un development/release build Android; non è una configurazione Expo Go-only.

Avvio: `npm install`, `npx expo prebuild`, poi `npm run android` oppure `npm run ios`.

## APK verification

La pipeline Android produce una release APK tramite `expo prebuild` + Gradle `assembleRelease` e la pubblica come artifact GitHub Actions. Il workflow esegue prima il typecheck mobile e usa Java 17/Node 20.

Il build viene avviato dai commit contrassegnati con `[build]`.


### Scanner runtime policy
The Android scanner does not take background still photos for preview detection. Card geometry is evaluated from the user-triggered capture; automatic capture remains disabled until a true live-frame processor is available.


### Native Android scanner
On Android, CARDGRADE uses the Google ML Kit Document Scanner as the primary acquisition layer. It provides a native document-scanner flow with automatic capture, edge detection, perspective correction and gallery import; the resulting JPEG is then passed to CARDGRADE recognition. The app no longer probes the camera by taking periodic background photos.


Build validation: native Android document scanner + manual four-corner review + AUTO ON flow.


Android APK requested after full-resolution scanner source update.
