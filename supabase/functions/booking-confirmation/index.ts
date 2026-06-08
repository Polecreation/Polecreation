const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type BookingLead = {
  first_name: string;
  last_name: string;
  email: string;
  birthdate: string;
  phone: string;
  appointment: string;
  whatsapp_consent: boolean;
  source?: string;
};

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
};

const getSupabaseSecretKey = () => {
  const legacyServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyServiceRoleKey) {
    return legacyServiceRoleKey;
  }

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeys) {
    throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS");
  }

  try {
    const parsed = JSON.parse(secretKeys);
    const firstKey = parsed.default || Object.values(parsed)[0];
    if (typeof firstKey === "string" && firstKey.length > 0) {
      return firstKey;
    }
  } catch (_error) {
    if (secretKeys.startsWith("sb_secret_")) {
      return secretKeys;
    }
  }

  throw new Error("Could not read Supabase secret key");
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const validateLead = (lead: Partial<BookingLead>) => {
  const requiredFields: Array<keyof BookingLead> = [
    "first_name",
    "last_name",
    "email",
    "birthdate",
    "phone",
    "appointment"
  ];

  for (const field of requiredFields) {
    if (!lead[field] || String(lead[field]).trim() === "") {
      throw new Error(`Missing field: ${field}`);
    }
  }

  if (!lead.whatsapp_consent) {
    throw new Error("Whatsapp consent is required");
  }
};

const sendEmail = async ({
  apiKey,
  from,
  to,
  subject,
  html,
  replyTo
}: {
  apiKey: string;
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      reply_to: replyTo
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend error: ${errorText || response.status}`);
  }
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = getSupabaseSecretKey();
    const resendApiKey = requiredEnv("RESEND_API_KEY");
    const fromEmail = requiredEnv("FROM_EMAIL");
    const adminEmail = requiredEnv("ADMIN_EMAIL");

    const lead = await request.json() as BookingLead;
    validateLead(lead);

    const insertResponse = await fetch(`${supabaseUrl}/rest/v1/probetraining_leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        first_name: lead.first_name.trim(),
        last_name: lead.last_name.trim(),
        email: lead.email.trim(),
        birthdate: lead.birthdate,
        phone: lead.phone.trim(),
        appointment: lead.appointment,
        whatsapp_consent: Boolean(lead.whatsapp_consent),
        source: lead.source || "landingpage",
        automation_status: "pending"
      })
    });

    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      throw new Error(`Supabase insert error: ${errorText || insertResponse.status}`);
    }

    const insertedRows = await insertResponse.json();
    const insertedLead = insertedRows[0];
    const leadId = insertedLead?.id;

    const firstName = escapeHtml(lead.first_name.trim());
    const lastName = escapeHtml(lead.last_name.trim());
    const appointment = escapeHtml(lead.appointment);
    const phone = escapeHtml(lead.phone.trim());
    const email = escapeHtml(lead.email.trim());
    const birthdate = escapeHtml(lead.birthdate);

    await sendEmail({
      apiKey: resendApiKey,
      from: fromEmail,
      to: lead.email.trim(),
      subject: "Dein Probetraining bei PoleCreation ist bestätigt",
      html: `
        <p>Hallo ${firstName}, 💕</p>

        <p>schön, dass du dein Probetraining bei PoleCreation gebucht hast. Endlich deine Chance für eine neue Leidenschaft und mehr Körperbewusstsein! Wir freuen uns riesig darauf, dir unsere wundervolle Sportart Poledance näherzubringen. 🩷</p>

        <p>📅 <strong>Dein Termin</strong><br>${appointment}</p>

        <p>📍 <strong>Unser Studio</strong><br>
        PoleCreation<br>
        Schelldorferstraße 1<br>
        87437 Kempten (Allgäu)</p>

        <p>🅿️ <strong>Parken</strong><br>
        Direkt vor dem Studio stehen leider keine Kundenparkplätze zur Verfügung. Du kannst bequem auf dem kostenlosen öffentlichen Parkplatz „Im Oberösch“ vor der Firma BSG Allgäu parken. Von dort sind es nur etwa 3 Minuten zu Fuß bis zum Studio.</p>

        <p>💰 <strong>Kosten</strong><br>15 € pro Person</p>

        <p>💳 <strong>Bezahlung</strong><br>Bar vor Ort oder mit Karte</p>

        <p>👗 <strong>Bitte mitbringen</strong></p>
        <ul>
          <li>Bequeme Sportkleidung</li>
          <li>Wenn möglich kurze Sportkleidung für besseren Grip</li>
          <li>Handtuch</li>
          <li>Trinkflasche</li>
        </ul>

        <p>🔔 <strong>Absagen &amp; Änderungen</strong><br>
        Falls du verhindert sein solltest, gib uns bitte möglichst 1–2 Tage vorher Bescheid, damit wir deinen Platz an eine andere Polerina weitergeben können. Vielen Dank für dein Verständnis. 🙏</p>

        <p>Bei Fragen sind wir jederzeit gerne für dich da.</p>

        <p>Wir freuen uns darauf, dich bald in unserem Studio willkommen zu heißen und gemeinsam mit dir durchzustarten! 💪💕</p>

        <p>Ganz liebe Grüße</p>

        <p>Anja &amp; das Team von PoleCreation</p>
      `,
      replyTo: adminEmail
    });

    await sendEmail({
      apiKey: resendApiKey,
      from: fromEmail,
      to: adminEmail,
      subject: "Neue Probetraining-Anmeldung",
      html: `
        <p>Es gibt eine neue Probetraining-Anmeldung.</p>
        <p>
          <strong>Name:</strong> ${firstName} ${lastName}<br>
          <strong>E-Mail:</strong> ${email}<br>
          <strong>Telefon:</strong> ${phone}<br>
          <strong>Geburtsdatum:</strong> ${birthdate}<br>
          <strong>Termin:</strong> ${appointment}
        </p>
      `,
      replyTo: lead.email.trim()
    });

    if (leadId) {
      await fetch(`${supabaseUrl}/rest/v1/probetraining_leads?id=eq.${leadId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`
        },
        body: JSON.stringify({
          confirmation_sent_at: new Date().toISOString(),
          automation_status: "confirmed_sent"
        })
      });
    }

    return new Response(JSON.stringify({ ok: true, id: leadId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
