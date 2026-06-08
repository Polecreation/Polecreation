# PoleCreation Probetraining Landingpage

Statische Landingpage für PoleCreation Kempten mit Video, Terminauswahl und Formular-Vorschau.

## Dateien

- `index.html` ist die Hauptseite für Netlify oder GitHub.
- `assets/` enthält Bilder, Logo und das Willkommensvideo.
- `supabase/schema.sql` enthält den ersten Tabellenentwurf für die Probetraining-Anmeldungen.

## Deployment

Für Netlify kann das Repository direkt verbunden werden. Als Publish Directory reicht der Projektordner selbst, da `index.html` im Root liegt.

## Backend-Idee

Das Formular kann später an Supabase angebunden werden:

1. Supabase-Projekt erstellen.
2. SQL aus `supabase/schema.sql` ausführen.
3. Formular in `index.html` mit Supabase URL und anon key verbinden.
4. Optional Make.com Webhook ergänzen, um WhatsApp-Bestätigungen auszulösen.
