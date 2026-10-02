# POYUKEGIMONHO Mobile

Companion app nativa dello stesso prodotto web.

- Mobile: scanner, camera, torcia, zoom e acquisizione.
- Web: catalogo, collection, market, storico e revisione.
- Shared: Card / Printing / Variant e pipeline di recognition, condition e pricing.

Stack: React Native + Expo Development Build + react-native-vision-camera.

Per la camera nativa è previsto un development build, non una configurazione Expo Go-only.

Avvio: `npm install`, `npx expo prebuild`, poi `npm run android` oppure `npm run ios`.

## APK verification

La pipeline Android produce una release APK tramite `expo prebuild` + Gradle `assembleRelease` e la pubblica come artifact GitHub Actions. Lo scanner mobile usa la fotocamera/scanner nativo con rilevamento automatico dei bordi, crop e correzione prospettica, seguito da OCR/riconoscimento e salvataggio nella collezione.
