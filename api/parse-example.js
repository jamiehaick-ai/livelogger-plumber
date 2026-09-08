// EXAMPLE serverless function — Vercel/Netlify Node.js function format.
// This is the piece that has to live on a server, not on the phone:
// the Anthropic API key can never be shipped inside index.html, because
// anyone could open dev tools and steal it.
//
// Kept in lockstep with server.js -- same TRADE_GLOSSARY, same systemPrompt,
// same {values, flags, date} response shape (Bryan Construction schema).
// If you change one, change both.
//
// Deploy this as /api/parse.js on Vercel (or the Netlify Functions
// equivalent) and set ANTHROPIC_API_KEY as an environment variable
// in that platform's dashboard — never hard-code it here.

const TRADE_GLOSSARY = [
  "PVC", "CPVC", "ABS", "PEX", "type L copper", "type M copper",
  "cast iron pipe", "galvanized pipe", "black iron pipe", "no-hub coupling",
  "hub and spigot", "compression fitting", "SharkBite fitting", "flare fitting",
  "sweat fitting", "solder joint", "flux", "pipe dope", "Teflon tape",
  "threaded fitting", "slip joint", "wye fitting", "tee fitting",
  "90 (elbow)", "45 (elbow)", "reducer", "cleanout", "P-trap", "vent stack",
  "main stack", "DWV (drain-waste-vent)", "backflow preventer",
  "RPZ (reduced pressure zone assembly)", "double check valve", "check valve",
  "gate valve", "ball valve", "angle stop", "curb stop", "corp stop",
  "water main", "meter pit", "sewer lateral", "lift station", "sump pump",
  "ejector pump", "grease trap", "grease interceptor", "hydro jetting",
  "snake", "auger", "closet flange", "wax ring", "hose bib", "mixing valve",
  "tempering valve", "expansion tank", "tankless water heater",
  "PRV (pressure reducing valve)", "backwater valve", "floor drain",
  "roof drain", "condensate line", "hydrostatic test", "pressure test",
  "rough-in", "top-out", "trim-out", "pitch (pipe slope)", "invert elevation",
  "backfill", "manhole", "storm drain",
];

// Basic per-IP rate limit -- same idea as server.js. Best-effort only here:
// serverless functions can cold-start on a fresh instance at any time,
// which resets this in-memory state. Still meaningfully helps within a
// single warm instance; a real distributed limit would need an external
// store (e.g. Upstash/Redis) or the hosting platform's own rate limiting.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const _rateLimitState = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const rec = _rateLimitState.get(ip);
  if (!rec || now > rec.resetAt) {
    _rateLimitState.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_LIMIT_MAX;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests -- try again in a minute." });
  }

  const { rawText, employee, date, priorReports } = req.body || {};

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "No ANTHROPIC_API_KEY set. Add it as an environment variable in your hosting dashboard.",
    });
  }
  if (!rawText) {
    return res.status(400).json({ error: "Missing rawText" });
  }

  const glossaryList = TRADE_GLOSSARY.join(", ");

  const priorReportsSection = (Array.isArray(priorReports) && priorReports.length)
    ? `

Prior reports touching one of today's location codes (most recent first) --
use these for two things only: (1) catch contradictions with today's
dictation, and (2) recognize established terminology/context for that
location so you parse today's report more confidently:
${priorReports.map((r, i) => `[${i === 0 ? "most recent" : `${i + 1} back`}, ${r.date}]\n${JSON.stringify(r, null, 1)}`).join("\n\n")}`
    : "";

  const systemPrompt = `You convert a plumber's spoken end-of-shift dictation into a structured
daily report for Bryan Construction's Subcontractor Daily Report form.
Return ONLY a JSON object, no other text, in exactly this shape:
{
  "values": {
    "workActivity": [ { "location": "...", "description": "..." } ],
    "manpower": [ { "classification": "...", "workers": "...", "totalHours": "..." } ],
    "scheduleImpacts": "...",
    "superintendentNotified": true | false | null,
    "safety": {
      "incidents": true | false,
      "incidentsDescribe": "...",
      "damage": true | false,
      "meeting": true | false,
      "meetingAddressed": true | false,
      "meetingTopic": "..."
    },
    "qc": { "inspectionsPerformed": "...", "materialDeliveries": "..." },
    "nextDay": { "description": "...", "inspectionsRequired": "...", "location": "...", "time": "..." }
  },
  "flags": ["..."],
  "date": "YYYY-MM-DD"
}

The report is currently dated ${date}. For the "date" key: just echo back
"${date}" unchanged UNLESS the dictation explicitly says this report is for
a different day than that (e.g. "this was actually yesterday," "put this
under the 5th, not today," "wrong date, should be Tuesday"). Only change it
on a clear, explicit statement -- never infer a different date from context
alone. If you do change it, resolve it to an actual YYYY-MM-DD date relative
to ${date}.

General rule for every field below: it is far better to leave something
blank/empty than to invent a plausible answer. Never fabricate a detail to
"fill a gap" -- an empty string, empty array, or null is always the correct
answer when the dictation genuinely didn't cover something.

workActivity (up to 4 entries):
- One entry per distinct location worked today. "location" is always a
  short code, not an address or description -- tradesmen refer to areas of
  this job by codes like "8A," "8H," "6L." Capture the code exactly as said
  (correcting only an obvious mishearing of the code itself, e.g. phonetic
  garbling of a letter/number).
- "description" is short, fragment-style, factual -- "Fire caulk; sleeves;
  move domestic water lines," not a narrative paragraph.
- If only one location was mentioned, return a single-entry array. Never
  invent additional locations that weren't mentioned.

manpower (up to 5 entries):
- "workers" is a headcount, "totalHours" is that row's TOTAL across all of
  them -- workers × hours-per-worker, not the per-worker number. E.g. "2
  plumbers, 8 hours each" -> workers: "2", totalHours: "16", never "8".
- If the crew worked different hours from each other on the same day, split
  them into separate manpower rows rather than averaging or picking one
  number -- e.g. "the apprentice left early at 6.5, the rest of us did 8"
  with 2 other workers -> one row {workers: "2", totalHours: "16"} and one
  row {workers: "1", totalHours: "6.5"}.
- "classification" is a labor/trade role (e.g. "Plumber," "Apprentice"),
  not a name.
- If no manpower detail was given at all, return an empty array -- never
  invent a crew.

scheduleImpacts / superintendentNotified:
- "scheduleImpacts" is free text describing anything that affected the
  schedule (a delay, a hold-up, waiting on something) -- empty string if
  nothing of the sort was mentioned.
- "superintendentNotified" is only ever true or false if the dictation
  explicitly says whether the superintendent was told about a schedule
  impact. If nothing was said about this either way, use null -- do not
  default it to false. null means "not applicable / not mentioned," which
  is the common case when there's no schedule impact to notify about.

safety (always fill this object; default every boolean to false unless
explicitly stated otherwise -- in practice, on real days on this job, all
three have almost always been "no"):
- "incidents": true only if the dictation clearly describes a safety
  incident or near-miss occurring today. "incidentsDescribe" only when true.
- "damage": true only if property damage or theft is clearly described.
- "meeting": true only if a safety meeting or tailgate/tailboard talk is
  clearly described as having happened today. "meetingTopic" only when true
  -- a short description of what it covered.
- "meetingAddressed": true if the dictation said ANYTHING about whether a
  safety meeting/brief happened today, in either direction -- "yes we had
  one," "no meeting today," "skipped the toolbox talk," all count as
  addressed. false only if the topic of a meeting never came up at all.
  This is separate from "meeting" itself -- a day can have meetingAddressed
  true and meeting false (explicitly confirmed no meeting happened).
- Do not infer any of these from silence or from unrelated safe-work talk.
  Absence of mention means false (and, for meetingAddressed, not addressed).

qc (quality control):
- "inspectionsPerformed": any inspection or test performed today. Empty
  string if not mentioned.
- "materialDeliveries": this one is required every day, and has three
  valid states, not two:
  1. Empty string -- ONLY when the dictation says nothing at all about
     deliveries, one way or the other. This is the "still needs asking"
     state.
  2. The literal string "None" -- when the dictation explicitly says there
     were no deliveries today ("no deliveries," "nothing came in," etc.).
     This is a COMPLETE answer, not a missing one -- never leave this as an
     empty string just because the answer was "none."
  3. An actual description -- when a delivery is described.

nextDay (all optional, empty string if not mentioned -- this section is
rarely used in practice, only fill what was actually said):
- "description": what's planned for the following workday.
- "inspectionsRequired" / "location" / "time": only if specifically stated.

Speech-to-text cleanup:
- This text came from a phone's voice dictation, so it will contain phonetic
  mis-hears of trade terminology. Here's a reference glossary of real terms
  this trade uses -- check dictation against these first: ${glossaryList}
- Also silently correct other obvious trade-term mis-hears not on that list
  when you're confident, based on context (skilled trades: electrical,
  plumbing, construction). Do not leave the garbled version in the output.
- Only correct clear phonetic mistranscriptions of terms. Do not "correct"
  genuinely ambiguous wording, and never change a number, measurement, name,
  or location code -- if those are unclear, keep them exactly as dictated
  rather than guessing.

Follow-ups and corrections -- this dictation may contain one of two special
labeled sections appended after the original text:
- A section starting "Follow-up:" is the worker answering a specific
  question about something that was missing. Use it to fill in whatever
  was blank -- it's additional information, not a contradiction of anything.
- A section starting "Correction from the worker after reviewing the
  report:" means something in the ORIGINAL dictation was wrong or
  misheard, and this new text overrides it. Apply the correction to
  whichever specific field(s) it's clearly about, and leave everything
  else from the original dictation untouched. This includes the "date" key
  above -- a correction can fix the date too.

"flags" -- a short list of plain-English strings, empty array if none:
- Only include something here if today's dictation appears to contradict,
  or meaningfully depart from, what a prior report for one of today's
  location codes said (e.g. a problem marked resolved before is described
  as ongoing again, work already reported as done is described as being
  redone unexpectedly).
- Each flag should read like a helpful heads-up to the person reviewing
  this later, not an accusation -- state what was said before, what's being
  said now, and let them judge it.
- Do NOT flag routine, expected day-to-day differences (different tasks,
  different hours, normal progress). Only flag genuine contradictions or
  things worth double-checking.
- If there are no prior reports provided below, or nothing contradicts,
  return an empty array.${priorReportsSection}`;

  const userPrompt = `Employee: ${employee}\nDate: ${date}\n\nDictation:\n"""\n${rawText}\n"""`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1800,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Anthropic API error:", data);
      return res.status(502).json({ error: data.error?.message || "Anthropic API error" });
    }

    const text = (data.content || []).map((b) => b.text || "").join("");
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return res.status(200).json({
      values: parsed.values || {},
      flags: parsed.flags || [],
      date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : date,
    });
  } catch (err) {
    console.error("Parse error:", err);
    return res.status(500).json({ error: "Failed to parse dictation" });
  }
}
