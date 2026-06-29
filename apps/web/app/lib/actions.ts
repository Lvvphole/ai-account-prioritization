import type { Recommendation } from "./types";

/**
 * Pure, browser-native action builders. These create real artifacts a rep can
 * use today — an email draft (mailto), a calendar invite (Google Calendar +
 * .ics), and call prep — without any backend, so the actions work in the demo
 * deploy. Nothing is auto-sent: customer-facing sends remain human-approved.
 */
export interface EmailDraft {
  subject: string;
  body: string;
}

/** Parse a rec's `draft` ("Subject: x\n\nbody") into parts, else synthesize. */
export function emailDraft(rec: Recommendation): EmailDraft {
  const draft = rec.nextBestAction.draft ?? "";
  const m = draft.match(/^subject:\s*(.+?)\n+([\s\S]*)$/i);
  if (m) return { subject: (m[1] ?? "").trim(), body: (m[2] ?? "").trim() };
  if (draft.trim()) return { subject: `Following up — ${rec.accountId}`, body: draft.trim() };
  return {
    subject: `Following up — ${rec.accountId}`,
    body: `Hi,\n\n${rec.nextBestAction.objective}\n\nBest,\n`,
  };
}

export function mailtoUrl(d: EmailDraft, to = ""): string {
  const q = new URLSearchParams({ subject: d.subject, body: d.body }).toString();
  return `mailto:${encodeURIComponent(to)}?${q}`;
}

export interface Meeting {
  title: string;
  details: string;
  start: Date;
  durationMin: number;
}

export function defaultMeeting(rec: Recommendation): Meeting {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  return {
    title: `Intro call — ${rec.accountId}`,
    details: rec.nextBestAction.objective,
    start,
    durationMin: 30,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Calendar UTC stamp: YYYYMMDDTHHMMSSZ. */
function stamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function googleCalendarUrl(m: Meeting): string {
  const end = new Date(m.start.getTime() + m.durationMin * 60000);
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: m.title,
    details: m.details,
    dates: `${stamp(m.start)}/${stamp(end)}`,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** Stable, content-derived UID so re-downloading the same meeting de-dupes. */
function icsUid(m: Meeting): string {
  const slug = m.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "meeting"}-${stamp(m.start)}@ai-account-prioritization`;
}

export function icsDataUri(m: Meeting): string {
  const end = new Date(m.start.getTime() + m.durationMin * 60000);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI Account Prioritization//EN",
    "BEGIN:VEVENT",
    // UID + DTSTAMP are required VEVENT properties (RFC 5545); without them
    // strict calendar clients reject the file or import duplicate events.
    `UID:${icsUid(m)}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(m.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${m.title}`,
    `DESCRIPTION:${m.details.replace(/\n/g, "\\n")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

export interface CallPrep {
  objective: string;
  talkingPoints: string[];
}

export function callPrep(rec: Recommendation): CallPrep {
  return {
    objective: rec.nextBestAction.objective,
    talkingPoints: rec.reasonCodes.map((c) => c.replace(/_/g, " ")),
  };
}
