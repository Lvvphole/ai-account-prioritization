import type { AppRole } from "@repo/supabase-client";
import { isSupabaseConfigured } from "../lib/supabase/config";

/**
 * Portal sign-in. With Supabase configured this is email + password. In demo
 * mode it offers a one-click Rep / Manager / Admin entry so each role gets a
 * coherent portal without credentials.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}) {
  const { redirectTo, error } = await searchParams;
  const demo = !isSupabaseConfigured();

  return (
    <div className="signin">
      <div className="signin-brand">
        <span className="brand-dot" aria-hidden="true" />
        <h1>Close more of the pipeline you already have</h1>
        <p className="muted">
          Sign in to see where your hours convert to revenue today — and the evidence
          behind every call.
        </p>
        <ul className="signin-points">
          <li>Start on the accounts most likely to move, not the loudest ones</li>
          <li>Catch at-risk renewals and stalled deals before they slip</li>
          <li>Act in the same minute — the email, call or meeting is already drafted</li>
        </ul>
      </div>

      <div className="signin-card">
        <h2>{demo ? "Choose a role to explore" : "Sign in"}</h2>
        <p className="signin-sub">
          {demo
            ? "No credentials needed — this demo signs you in as the role you pick."
            : "Use your work email and password."}
        </p>

        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}

        {demo ? (
          <div className="role-grid">
            <RoleEntry
              role="rep"
              icon="◑"
              label="Rep"
              sub="Today’s priority list, evidence and actions"
            />
            <RoleEntry
              role="manager"
              icon="◕"
              label="Manager"
              sub="Team coverage and held recommendations"
            />
            <RoleEntry
              role="admin"
              icon="◍"
              label="Admin"
              sub="Scoring weights and thresholds"
            />
          </div>
        ) : (
          <form action="/auth/login" method="post" style={{ marginTop: 18 }}>
            <input type="hidden" name="redirectTo" value={redirectTo ?? "/dashboard"} />
            <div className="field">
              <label>
                Email
                <input name="email" type="email" required autoComplete="username" />
              </label>
            </div>
            <div className="field">
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </label>
            </div>
            <button type="submit" className="btn-primary" style={{ width: "100%" }}>
              Sign in
            </button>
          </form>
        )}

        <p className="signin-foot">
          Recommendations are drafted, never auto-sent. Customer-facing actions stay
          gated on a human.
        </p>
      </div>
    </div>
  );
}

function RoleEntry({
  role,
  icon,
  label,
  sub,
}: {
  role: AppRole;
  icon: string;
  label: string;
  sub: string;
}) {
  return (
    <form action="/auth/demo" method="post">
      <input type="hidden" name="role" value={role} />
      <button type="submit" className="role-btn">
        <span className="role-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="role-text">
          <span className="role-name">{label}</span>
          <span className="role-sub">{sub}</span>
        </span>
        <span className="role-go" aria-hidden="true">
          →
        </span>
      </button>
    </form>
  );
}
