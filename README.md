# PoleCreation Probetraining Landingpage

Statische Landingpage für PoleCreation Kempten mit Video, Terminauswahl und Buchungsformular.

## Dateien

- `index.html` ist die Hauptseite für Netlify oder ein anderes statisches Hosting.
- `assets/` enthält Bilder und Logos.
- `netlify.toml` enthält die statische Netlify-Konfiguration.
- `supabase/schema.sql` enthält die Tabelle für Probetraining-Anmeldungen.
- `supabase/functions/bright-function/index.ts` speichert Anfragen und versendet E-Mails über Brevo.
- `admin.html` ist der kleine Admin-Bereich für Probetraining-Termine.
- `supabase/functions/manage-trial-dates/index.ts` verwaltet Termine geschützt per Admin-Passwort.

## Buchungsablauf

1. Der Kunde füllt das Formular in `index.html` aus.
2. Das Formular sendet die Anfrage an die Supabase Edge Function `bright-function`.
3. Die Function speichert den Lead in `public.probetraining_leads`.
4. Der Kunde erhält über Brevo eine ausführliche Bestätigungs-E-Mail.
5. PoleCreation erhält eine kurze interne Benachrichtigung mit den Kontaktdaten und dem Termin.

Wenn der Lead gespeichert wurde, aber der E-Mail-Versand fehlschlägt, bleibt die Anfrage in der Datenbank mit `automation_status = 'email_failed'` erhalten. So muss der Kunde nicht erneut absenden und PoleCreation kann manuell nachfassen.

## Supabase Setup

1. Supabase-Projekt öffnen.
2. SQL aus `supabase/schema.sql` im SQL Editor ausführen.
3. Edge Function deployen:

   ```bash
   supabase functions deploy bright-function
   ```

4. In Supabase die folgenden Secrets setzen:

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `BREVO_API_KEY`
   - `BREVO_SENDER_EMAIL`
   - `BREVO_SENDER_NAME`
   - `ADMIN_EMAIL`

Die Landingpage ruft aktuell diese Function-URL auf:

```text
https://hfwkoqfuvmavvxsxnlcq.supabase.co/functions/v1/bright-function
```

Die Landingpage lädt sichtbare Termine aus `public.trial_dates`. Falls Supabase nicht erreichbar ist, bleiben die zuletzt fest hinterlegten Termine als Reserve sichtbar.

## Admin-Bereich Termine

Der Admin-Bereich liegt unter:

```text
/admin.html
```

Damit Anja Termine pflegen kann:

1. SQL aus `supabase/schema.sql` erneut im Supabase SQL Editor ausführen.
2. In Supabase unter Edge Functions > Secrets ein starkes Secret setzen:

   - `ADMIN_PASSWORD`

3. Neue Edge Function deployen:

   ```bash
   supabase functions deploy manage-trial-dates
   ```

4. Danach `/admin.html` öffnen, Admin-Passwort eingeben und Termine eintragen oder ausblenden.

Die Admin-Seite schreibt keine geheimen Supabase-Schlüssel in den Browser. Änderungen laufen über die geschützte Edge Function `manage-trial-dates`.

## Netlify Deployment

Das Repository kann direkt mit Netlify verbunden werden.

- Build command: leer lassen
- Publish directory: `.`
- Konfigurationsdatei: `netlify.toml`

Vor dem Produktivgang einen Preview Deploy testen und eine echte Testbuchung ausführen.

## Subdomain

Gewünschte Subdomain:

```text
probetraining.polecreation.de
```

Aktueller Stand am 11.06.2026: Die Subdomain zeigt per DNS auf Wix (`cdn1.wixdns.net`) und leitet auf `https://www.polecreation.de/` weiter.

Für Netlify muss die Subdomain im DNS von Wix/Domainverwaltung von Wix weg auf die Netlify-Zieladresse geändert werden. Typischer Ablauf:

1. Netlify-Site erstellen oder bestehende Site verbinden.
2. In Netlify `probetraining.polecreation.de` als Custom Domain hinzufügen.
3. Den von Netlify angegebenen DNS-Zielhost kopieren.
4. Im DNS den CNAME für `probetraining` auf diesen Netlify-Zielhost setzen.
5. In Netlify warten, bis SSL/HTTPS aktiv ist.

Erst danach sollte die Landingpage offiziell verlinkt oder beworben werden.
Letzter Deploy-Trigger: 2026-06-29
