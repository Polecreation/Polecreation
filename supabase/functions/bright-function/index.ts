const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

const MAX_WAITLIST_SPOTS = 5;

type BookingLead = {
  first_name: string;
  last_name: string;
  email: string;
  birthdate: string;
  phone: string;
  appointment: string;
  whatsapp_consent: boolean;
  privacy_consent: boolean;
  source?: string;
  bot_field?: string;
};

type LeadStatusPatch = {
  status?: string;
  automation_status?: string;
  confirmation_sent_at?: string;
  admin_notification_sent_at?: string;
  email_error?: string | null;
  updated_at?: string;
};

type TrialDateRow = {
  label: string;
  capacity: number;
  active: boolean;
  date: string;
};

type ExistingLeadRow = {
  id: string;
  status: string;
};

class PublicError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

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

const readString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeBirthdate = (value: unknown) => {
  const raw = readString(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const digits = raw.replace(/\D/g, "");

  if (digits.length === 8) {
    const day = digits.slice(0, 2);
    const month = digits.slice(2, 4);
    const year = digits.slice(4, 8);
    return `${year}-${month}-${day}`;
  }

  const dateParts = raw.match(/^(\d{1,2})\D+(\d{1,2})\D+((?:19|20)\d{2})$/);
  if (dateParts) {
    const day = dateParts[1].padStart(2, "0");
    const month = dateParts[2].padStart(2, "0");
    const year = dateParts[3];
    return `${year}-${month}-${day}`;
  }

  return raw;
};

const normalizeLead = (input: Partial<Record<keyof BookingLead, unknown>>): BookingLead => ({
  first_name: readString(input.first_name),
  last_name: readString(input.last_name),
  email: readString(input.email).toLowerCase(),
  birthdate: normalizeBirthdate(input.birthdate),
  phone: readString(input.phone),
  appointment: readString(input.appointment),
  whatsapp_consent:
    input.whatsapp_consent === true ||
    input.whatsapp_consent === "true" ||
    input.whatsapp_consent === "on",
  privacy_consent:
    input.privacy_consent === true ||
    input.privacy_consent === "true" ||
    input.privacy_consent === "on",
  source: readString(input.source) || "landingpage",
  bot_field: readString(input.bot_field)
});

const isValidDateInput = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const validateLead = (lead: BookingLead) => {
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
      throw new PublicError("Bitte fülle alle Pflichtfelder aus.");
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    throw new PublicError("Bitte gib eine gültige E-Mail-Adresse ein.");
  }

  if (!isValidDateInput(lead.birthdate)) {
    throw new PublicError("Bitte gib ein gültiges Geburtsdatum ein.");
  }

  if (!lead.whatsapp_consent) {
    throw new PublicError("Bitte bestätige die Kontaktaufnahme per WhatsApp.");
  }

  if (!lead.privacy_consent) {
    throw new PublicError("Bitte bestätige die Datenschutzerklärung.");
  }
};

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const supabaseJsonRequest = async <T>(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string
): Promise<T> => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "apikey": serviceRoleKey,
      "Authorization": `Bearer ${serviceRoleKey}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase read error: ${errorText || response.status}`);
  }

  return response.json();
};

const getBookingMode = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  appointment: string
) => {
  const encodedAppointment = encodeURIComponent(appointment);
  const dates = await supabaseJsonRequest<TrialDateRow[]>(
    supabaseUrl,
    serviceRoleKey,
    `trial_dates?select=label,capacity,active,date&label=eq.${encodedAppointment}&active=eq.true&limit=1`
  );

  if (!dates.length) {
    throw new PublicError("Dieser Termin ist nicht mehr buchbar. Bitte wähle einen aktuellen Termin aus.", 409);
  }

  const trialDate = dates[0];
  const todayIso = new Date().toISOString().slice(0, 10);

  if (trialDate.date < todayIso) {
    throw new PublicError("Dieser Termin liegt bereits in der Vergangenheit. Bitte wähle einen aktuellen Termin aus.", 409);
  }
  const existingLeads = await supabaseJsonRequest<ExistingLeadRow[]>(
    supabaseUrl,
    serviceRoleKey,
    `probetraining_leads?select=id,status&appointment=eq.${encodedAppointment}&status=neq.cancelled`
  );

  const capacity = Number(trialDate.capacity || 0);
  const bookedCount = existingLeads.filter((lead) => lead.status !== "waitlist").length;
  const waitlistCount = existingLeads.filter((lead) => lead.status === "waitlist").length;
  const isWaitlist = bookedCount >= capacity;

  return {
    isWaitlist,
    isSoldOut: isWaitlist && waitlistCount >= MAX_WAITLIST_SPOTS,
    capacity,
    bookedCount,
    waitlistCount
  };
};

const sendEmail = async ({
  apiKey,
  senderEmail,
  senderName,
  to,
  subject,
  html,
  replyTo
}: {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}) => {
  const recipients = Array.isArray(to) ? to : [to];
  const payload: Record<string, unknown> = {
    sender: {
      name: senderName,
      email: senderEmail
    },
    to: recipients.map((email) => ({ email })),
    subject,
    htmlContent: html
  };

  if (replyTo) {
    payload.replyTo = { email: replyTo };
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brevo error: ${errorText || response.status}`);
  }
};

const updateLeadStatus = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  leadId: string | undefined,
  patch: LeadStatusPatch
) => {
  if (!leadId) {
    return;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/probetraining_leads?id=eq.${encodeURIComponent(leadId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        ...patch,
        updated_at: new Date().toISOString()
      })
    }
  );

  if (!response.ok) {
    console.error("Supabase status update error:", await response.text());
  }
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = getSupabaseSecretKey();
    const brevoApiKey = requiredEnv("BREVO_API_KEY");
    const senderEmail = requiredEnv("BREVO_SENDER_EMAIL");
    const senderName = Deno.env.get("BREVO_SENDER_NAME") || "PoleCreation";
    const adminEmail = requiredEnv("ADMIN_EMAIL");

    const lead = normalizeLead(await request.json());
    validateLead(lead);

    if (lead.bot_field) {
      return jsonResponse({
        ok: true,
        message: "Danke! Deine Anfrage wurde gespeichert. Du erhältst gleich eine Bestätigung per E-Mail."
      });
    }

    const bookingMode = await getBookingMode(supabaseUrl, serviceRoleKey, lead.appointment);
    if (bookingMode.isSoldOut) {
      throw new PublicError("Dieser Termin ist bereits ausgebucht und die Warteliste ist voll. Bitte wähle einen anderen Termin oder melde dich direkt bei PoleCreation.", 409);
    }

    const leadStatus = bookingMode.isWaitlist ? "waitlist" : "new";

    const insertResponse = await fetch(`${supabaseUrl}/rest/v1/probetraining_leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        first_name: lead.first_name,
        last_name: lead.last_name,
        email: lead.email,
        birthdate: lead.birthdate,
        phone: lead.phone,
        appointment: lead.appointment,
        whatsapp_consent: lead.whatsapp_consent,
        privacy_consent: lead.privacy_consent,
        source: lead.source || "landingpage",
        status: leadStatus,
        automation_status: bookingMode.isWaitlist ? "waitlist_pending" : "pending",
        email_error: null
      })
    });

    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      throw new Error(`Supabase insert error: ${errorText || insertResponse.status}`);
    }

    const insertedRows = await insertResponse.json();
    const insertedLead = insertedRows[0];
    const leadId = insertedLead?.id as string | undefined;

    const firstName = escapeHtml(lead.first_name);
    const lastName = escapeHtml(lead.last_name);
    const appointment = escapeHtml(lead.appointment);
    const phone = escapeHtml(lead.phone);
    const email = escapeHtml(lead.email);
    const birthdate = escapeHtml(lead.birthdate);

    let customerEmailSent = false;
    let adminEmailSent = false;

    try {
      const customerSubject = bookingMode.isWaitlist
        ? "Du bist auf der Warteliste bei PoleCreation"
        : "Dein Probetraining bei PoleCreation ist bestätigt";
      const introText = bookingMode.isWaitlist
        ? "schön, dass du dich für ein Probetraining bei PoleCreation eingetragen hast. Der ausgewählte Termin ist aktuell voll. Wir haben dich deshalb auf die Warteliste gesetzt und melden uns bei dir, sobald ein Platz frei wird."
        : "schön, dass du dein Probetraining bei PoleCreation gebucht hast. Endlich deine Chance für eine neue Leidenschaft und mehr Körperbewusstsein! Wir freuen uns riesig darauf, dir unsere wundervolle Sportart Poledance näherzubringen.";
      const appointmentHeadline = bookingMode.isWaitlist ? "Dein Wartelistentermin" : "Dein Termin";

      await sendEmail({
        apiKey: brevoApiKey,
        senderEmail,
        senderName,
        to: lead.email,
        subject: customerSubject,
        html: `
          <p>Hallo ${firstName},</p>

          <p>${introText}</p>

          <p><strong>${appointmentHeadline}</strong><br>${appointment}</p>

          <p><strong>Unser Studio</strong><br>
          PoleCreation<br>
          Schelldorferstraße 1<br>
          87437 Kempten (Allgäu)</p>

          <p><strong>Parken</strong><br>
          Direkt vor dem Studio stehen leider keine Kundenparkplätze zur Verfügung. Du kannst bequem auf dem kostenlosen öffentlichen Parkplatz "Im Oberösch" vor der Firma BSG Allgäu parken. Von dort sind es nur etwa 3 Minuten zu Fuß bis zum Studio.</p>

          <p><strong>Kosten</strong><br>15 EUR pro Person</p>

          <p><strong>Bezahlung</strong><br>Bar vor Ort oder mit Karte</p>

          <p><strong>Bitte mitbringen</strong></p>
          <ul>
            <li>Bequeme Sportkleidung</li>
            <li>Wenn möglich kurze Sportkleidung für besseren Grip</li>
            <li>Handtuch</li>
            <li>Trinkflasche</li>
          </ul>

          <p><strong>Absagen &amp; Änderungen</strong><br>
          Falls du verhindert sein solltest, gib uns bitte möglichst 1-2 Tage vorher Bescheid, damit wir deinen Platz an eine andere Polerina weitergeben können. Vielen Dank für dein Verständnis.</p>

          <p>Bei Fragen sind wir jederzeit gerne für dich da.</p>

          <p>Wir freuen uns darauf, dich bald in unserem Studio willkommen zu heißen und gemeinsam mit dir durchzustarten!</p>

          <p>Ganz liebe Grüße<br>
          Anja &amp; das Team von PoleCreation</p>
        `,
        replyTo: adminEmail
      });
      customerEmailSent = true;

      await sendEmail({
        apiKey: brevoApiKey,
        senderEmail,
        senderName,
        to: adminEmail,
        subject: bookingMode.isWaitlist ? "Neue Wartelisten-Anfrage" : "Neue Probetraining-Anmeldung",
        html: `
          <p>Es gibt eine neue ${bookingMode.isWaitlist ? "Wartelisten-Anfrage" : "Probetraining-Anmeldung"}.</p>
          <p>
            <strong>Status:</strong> ${bookingMode.isWaitlist ? "Warteliste" : "Bestätigt"}<br>
            <strong>Name:</strong> ${firstName} ${lastName}<br>
            <strong>E-Mail:</strong> ${email}<br>
            <strong>Telefon:</strong> ${phone}<br>
            <strong>Geburtsdatum:</strong> ${birthdate}<br>
            <strong>Termin:</strong> ${appointment}<br>
            <strong>Plätze:</strong> ${bookingMode.bookedCount}${bookingMode.capacity ? ` / ${bookingMode.capacity}` : ""}<br>
            <strong>Warteliste:</strong> ${bookingMode.waitlistCount} / ${MAX_WAITLIST_SPOTS}
          </p>
        `,
        replyTo: lead.email
      });
      adminEmailSent = true;

      const sentAt = new Date().toISOString();
      await updateLeadStatus(supabaseUrl, serviceRoleKey, leadId, {
        status: bookingMode.isWaitlist ? "waitlist" : "confirmed",
        automation_status: bookingMode.isWaitlist ? "waitlist_sent" : "confirmed_sent",
        confirmation_sent_at: sentAt,
        admin_notification_sent_at: sentAt,
        email_error: null
      });

      return jsonResponse({
        ok: true,
        id: leadId,
        email_sent: true,
        status: bookingMode.isWaitlist ? "waitlist" : "confirmed",
        message: bookingMode.isWaitlist
          ? "Danke! Der Termin ist aktuell voll. Du wurdest auf die Warteliste gesetzt und erhältst gleich eine E-Mail mit allen Infos."
          : "Danke! Deine Anfrage ist eingegangen. Du erhältst gleich eine Bestätigung per E-Mail."
      });
    } catch (emailError) {
      const sentAt = new Date().toISOString();
      await updateLeadStatus(supabaseUrl, serviceRoleKey, leadId, {
        status: bookingMode.isWaitlist ? "waitlist" : "email_pending",
        automation_status: "email_failed",
        confirmation_sent_at: customerEmailSent ? sentAt : undefined,
        admin_notification_sent_at: adminEmailSent ? sentAt : undefined,
        email_error: toErrorMessage(emailError).slice(0, 1000)
      });

      console.error("Booking email error:", emailError);

      return jsonResponse(
        {
          ok: true,
          id: leadId,
          email_sent: false,
          message:
            "Deine Anfrage wurde gespeichert. Falls die Bestätigungs-E-Mail nicht gleich ankommt, meldet sich PoleCreation manuell bei dir."
        },
        202
      );
    }
  } catch (error) {
    console.error("Booking request error:", error);

    if (error instanceof PublicError) {
      return jsonResponse({ ok: false, message: error.message }, error.status);
    }

    return jsonResponse(
      {
        ok: false,
        message:
          "Die Anfrage konnte gerade nicht verarbeitet werden. Bitte versuche es später erneut oder melde dich direkt bei PoleCreation."
      },
      500
    );
  }
});
