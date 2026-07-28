const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-password",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

const MAX_WAITLIST_SPOTS = 5;

type TrialDatePayload = {
  action?: string;
  id?: string;
  date?: string;
  time?: string;
  capacity?: number;
  active?: boolean;
};

type TrialDateRow = {
  id: string;
  date: string;
  time: string;
  label: string;
  capacity: number;
  active: boolean;
  sort_order: number;
  booked_count?: number;
  waitlist_count?: number;
  is_full?: boolean;
  is_sold_out?: boolean;
};

type LeadRow = {
  appointment: string;
  status: string;
};

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

const isValidDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const isValidTime = (value: string) => /^\d{2}:\d{2}$/.test(value);

const formatGermanLabel = (dateValue: string, timeValue: string) => {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "UTC" }).format(date);
  const formattedDate = `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
  return `${weekday}, ${formattedDate} - ${timeValue} Uhr`;
};

const supabaseRequest = async (
  path: string,
  options: RequestInit,
  supabaseUrl: string,
  serviceRoleKey: string
) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "apikey": serviceRoleKey,
      "Authorization": `Bearer ${serviceRoleKey}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Supabase error ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const getEnrichedDates = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  onlyFutureActive = false
) => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const dateFilter = onlyFutureActive ? `&active=eq.true&date=gte.${todayIso}` : "";
  const dates = (await supabaseRequest(
    `trial_dates?select=*&order=active.desc,sort_order.asc,date.asc,time.asc${dateFilter}`,
    { method: "GET" },
    supabaseUrl,
    serviceRoleKey
  )) as TrialDateRow[];

  const leads = (await supabaseRequest(
    "probetraining_leads?select=appointment,status",
    { method: "GET" },
    supabaseUrl,
    serviceRoleKey
  )) as LeadRow[];

  const countsByAppointment = new Map<string, { booked: number; waitlist: number }>();
  leads.forEach((lead) => {
    const appointment = lead.appointment || "";
    if (!appointment) return;
    const counts = countsByAppointment.get(appointment) || { booked: 0, waitlist: 0 };
    if (lead.status === "waitlist") {
      counts.waitlist += 1;
    } else if (lead.status !== "cancelled") {
      counts.booked += 1;
    }
    countsByAppointment.set(appointment, counts);
  });

  return dates.map((date) => {
    const counts = countsByAppointment.get(date.label) || { booked: 0, waitlist: 0 };
    const capacity = Number(date.capacity || 0);
    const isFull = capacity > 0 && counts.booked >= capacity;
    return {
      ...date,
      booked_count: counts.booked,
      waitlist_count: counts.waitlist,
      is_full: isFull,
      is_sold_out: isFull && counts.waitlist >= MAX_WAITLIST_SPOTS
    };
  });
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
  }

  try {
    const payload = (await request.json()) as TrialDatePayload;
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = getSupabaseSecretKey();

    if (payload.action === "public-list") {
      const dates = await getEnrichedDates(supabaseUrl, serviceRoleKey, true);
      const publicDates = dates
        .filter((date) => date.active && !date.is_sold_out)
        .map((date) => ({
          label: date.label,
          date: date.date,
          time: date.time,
          capacity: date.capacity,
          booked_count: date.booked_count,
          waitlist_count: date.waitlist_count,
          is_full: date.is_full,
          is_waitlist: date.is_full && !date.is_sold_out
        }));

      return jsonResponse({ ok: true, dates: publicDates });
    }

    const adminPassword = requiredEnv("ADMIN_PASSWORD");
    const receivedPassword = request.headers.get("x-admin-password") || "";

    if (!receivedPassword || receivedPassword !== adminPassword) {
      return jsonResponse({ ok: false, message: "Das Admin Passwort ist nicht korrekt." }, 401);
    }

    if (payload.action === "list") {
      const enrichedDates = await getEnrichedDates(supabaseUrl, serviceRoleKey);
      return jsonResponse({ ok: true, dates: enrichedDates });
    }

    if (payload.action === "create") {
      const date = String(payload.date || "").trim();
      const time = String(payload.time || "").trim();
      const capacity = Number.isFinite(payload.capacity) ? Number(payload.capacity) : 8;

      if (!isValidDate(date) || !isValidTime(time)) {
        return jsonResponse({ ok: false, message: "Bitte Datum und Uhrzeit prüfen." }, 400);
      }

      const label = formatGermanLabel(date, time);
      const sortOrder = Number(`${date.replaceAll("-", "")}${time.replace(":", "")}`);
      const rows = await supabaseRequest(
        "trial_dates",
        {
          method: "POST",
          headers: { "Prefer": "return=representation" },
          body: JSON.stringify({
            date,
            time,
            label,
            capacity,
            active: true,
            sort_order: sortOrder
          })
        },
        supabaseUrl,
        serviceRoleKey
      );

      return jsonResponse({ ok: true, date: rows?.[0] });
    }

    if (payload.action === "update") {
      if (!payload.id) {
        return jsonResponse({ ok: false, message: "Termin-ID fehlt." }, 400);
      }

      const date = String(payload.date || "").trim();
      const time = String(payload.time || "").trim();
      const capacity = Number.isFinite(payload.capacity) ? Number(payload.capacity) : 8;

      if (!isValidDate(date) || !isValidTime(time) || capacity < 1) {
        return jsonResponse({ ok: false, message: "Bitte Datum, Uhrzeit und Plätze prüfen." }, 400);
      }

      const label = formatGermanLabel(date, time);
      const sortOrder = Number(`${date.replaceAll("-", "")}${time.replace(":", "")}`);

      const rows = await supabaseRequest(
        `trial_dates?id=eq.${encodeURIComponent(payload.id)}`,
        {
          method: "PATCH",
          headers: { "Prefer": "return=representation" },
          body: JSON.stringify({
            date,
            time,
            label,
            capacity,
            sort_order: sortOrder,
            updated_at: new Date().toISOString()
          })
        },
        supabaseUrl,
        serviceRoleKey
      );

      return jsonResponse({ ok: true, date: rows?.[0] });
    }

    if (payload.action === "toggle") {
      if (!payload.id) {
        return jsonResponse({ ok: false, message: "Termin-ID fehlt." }, 400);
      }

      await supabaseRequest(
        `trial_dates?id=eq.${encodeURIComponent(payload.id)}`,
        {
          method: "PATCH",
          headers: { "Prefer": "return=minimal" },
          body: JSON.stringify({
            active: payload.active === true,
            updated_at: new Date().toISOString()
          })
        },
        supabaseUrl,
        serviceRoleKey
      );

      return jsonResponse({ ok: true });
    }

    if (payload.action === "delete") {
      if (!payload.id) {
        return jsonResponse({ ok: false, message: "Termin-ID fehlt." }, 400);
      }

      await supabaseRequest(
        `trial_dates?id=eq.${encodeURIComponent(payload.id)}`,
        {
          method: "DELETE",
          headers: { "Prefer": "return=minimal" }
        },
        supabaseUrl,
        serviceRoleKey
      );

      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false, message: "Unbekannte Aktion." }, 400);
  } catch (error) {
    console.error("Manage trial dates error:", error);
    return jsonResponse(
      {
        ok: false,
        message: "Die Termine konnten gerade nicht verwaltet werden. Bitte prüfe Supabase Schema, Secrets und Function Deploy."
      },
      500
    );
  }
});
