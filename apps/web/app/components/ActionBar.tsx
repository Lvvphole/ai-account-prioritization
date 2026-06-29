"use client";

import { useEffect, useState } from "react";
import type { Recommendation } from "../lib/types";
import {
  emailDraft,
  mailtoUrl,
  defaultMeeting,
  googleCalendarUrl,
  icsDataUri,
  callPrep,
  type CallPrep,
  type Meeting,
} from "../lib/actions";

type Panel = "email" | "call" | "meeting" | null;

/**
 * Interactive action bar: draft an email, prep + log a call, or schedule a
 * meeting — all with real browser-native artifacts (mailto, clipboard, Google
 * Calendar / .ics). Drafts only; customer-facing sends stay human-approved.
 */
export default function ActionBar({ rec }: { rec: Recommendation }) {
  const seed = emailDraft(rec);
  const prep = callPrep(rec);

  const [panel, setPanel] = useState<Panel>(null);
  const [subject, setSubject] = useState(seed.subject);
  const [body, setBody] = useState(seed.body);
  const [copied, setCopied] = useState(false);
  const [logged, setLogged] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(30);

  // Default the meeting to "tomorrow 10:00" on the client only, to avoid a
  // server/client timezone hydration mismatch.
  useEffect(() => {
    const m = defaultMeeting(rec);
    setDate(toDateInput(m.start));
    setTime(toTimeInput(m.start));
  }, [rec]);

  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  const meeting: Meeting = {
    title: `Intro call — ${rec.accountId}`,
    details: rec.nextBestAction.objective,
    start: fromInputs(date, time),
    durationMin: duration,
  };
  const recommended = rec.nextBestAction.type;

  return (
    <div>
      <div className="actions">
        <button
          className={`action-btn${recommended === "send_email" ? " rec" : ""}`}
          onClick={() => toggle("email")}
        >
          ✉️ Draft email
        </button>
        <button className="action-btn" onClick={() => toggle("call")}>
          📞 Log a call
        </button>
        <button className="action-btn" onClick={() => toggle("meeting")}>
          📅 Schedule meeting
        </button>
      </div>

      {rec.nextBestAction.customerFacing ? (
        <p className="note">
          Draft only — sending is gated on human approval (status: {rec.approvalStatus}).
        </p>
      ) : null}

      {panel === "email" ? (
        <div className="action-panel">
          <div className="field">
            <label>
              Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
          </div>
          <div className="field">
            <label>
              Body
              <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
          </div>
          <div className="actions">
            <a className="action-btn btn-primary" href={mailtoUrl({ subject, body })}>
              Open in email client
            </a>
            <button className="action-btn" onClick={() => copy(`Subject: ${subject}\n\n${body}`)}>
              {copied ? "Copied ✓" : "Copy draft"}
            </button>
          </div>
        </div>
      ) : null}

      {panel === "call" ? (
        <div className="action-panel">
          <p style={{ marginTop: 0 }}>
            <strong>Objective:</strong> {prep.objective}
          </p>
          <p className="muted" style={{ margin: "0 0 6px" }}>
            Talking points
          </p>
          <div>
            {prep.talkingPoints.map((t) => (
              <span key={t} className="badge">
                {t}
              </span>
            ))}
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="action-btn" onClick={() => copy(callNotes(prep))}>
              Copy call notes
            </button>
            <button
              className={`action-btn${logged ? " rec" : ""}`}
              onClick={() => setLogged(new Date().toLocaleString())}
            >
              {logged ? `Logged ✓ ${logged}` : "Mark as logged"}
            </button>
          </div>
        </div>
      ) : null}

      {panel === "meeting" ? (
        <div className="action-panel">
          <div className="actions" style={{ marginBottom: 10 }}>
            <label className="field" style={{ margin: 0 }}>
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field" style={{ margin: 0 }}>
              Time
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label className="field" style={{ margin: 0 }}>
              Duration
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>60 min</option>
              </select>
            </label>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            {meeting.title}
          </p>
          <div className="actions">
            <a
              className="action-btn btn-primary"
              href={googleCalendarUrl(meeting)}
              target="_blank"
              rel="noreferrer"
            >
              Add to Google Calendar
            </a>
            <a className="action-btn" href={icsDataUri(meeting)} download={`${rec.accountId}-meeting.ics`}>
              Download .ics
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function callNotes(p: CallPrep): string {
  return `Objective: ${p.objective}\nTalking points:\n${p.talkingPoints
    .map((t) => `- ${t}`)
    .join("\n")}`;
}
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function toTimeInput(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fromInputs(date: string, time: string): Date {
  if (!date) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d;
  }
  return new Date(`${date}T${time || "10:00"}`);
}
const pad2 = (n: number) => String(n).padStart(2, "0");
