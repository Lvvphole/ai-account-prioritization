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
        <h1>Close the Deals Hiding in Your Pipeline.</h1>
        <p className="muted">Your Accounts, Ranked and Drafted, Ready to Work.</p>
        <ul className="signin-points">
          <li>Work the accounts that need you most today.</li>
          <li>Catch at-risk renewals before they slip.</li>
          <li>Act with the email or call already drafted.</li>
        </ul>
      </div>

      <div className="signin-card">
        <h2>{demo ? "Choose A Role to Explore" : "Sign In"}</h2>
        <p className="signin-sub">
          {demo
            ? "No credentials needed. Pick a role to sign in."
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
              redirectTo={redirectTo}
            />
            <RoleEntry
              role="manager"
              icon="◕"
              label="Manager"
              sub="Team coverage and held recommendations"
              redirectTo={redirectTo}
            />
            <RoleEntry
              role="admin"
              icon="◍"
              label="Admin"
              sub="Scoring weights and thresholds"
              redirectTo={redirectTo}
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
              Sign In
            </button>
          </form>
        )}

        <p className="signin-foot">
          Recommendations are drafted, never auto-sent. Every customer-facing message
          waits for your approval.
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
  redirectTo,
}: {
  role: AppRole;
  icon: string;
  label: string;
  sub: string;
  redirectTo?: string;
}) {
  return (
    <form action="/auth/demo" method="post">
      <input type="hidden" name="role" value={role} />
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
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
