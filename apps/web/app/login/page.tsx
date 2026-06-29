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
    <div className="auth">
      <div className="auth-card">
        <h1>Sign in to the portal</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Your verified daily account action plan.
        </p>
        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}

        {demo ? (
          <>
            <p className="note">Demo mode — choose a role to enter the portal.</p>
            <div className="role-grid">
              <RoleEntry role="rep" label="Rep" sub="Daily priority list & actions" />
              <RoleEntry role="manager" label="Manager" sub="Coverage & held recommendations" />
              <RoleEntry role="admin" label="Admin" sub="Scoring configuration" />
            </div>
          </>
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
      </div>
    </div>
  );
}

function RoleEntry({ role, label, sub }: { role: AppRole; label: string; sub: string }) {
  return (
    <form action="/auth/demo" method="post">
      <input type="hidden" name="role" value={role} />
      <button type="submit" className="role-btn">
        <span className="role-name">{label}</span>
        <span className="role-sub">{sub}</span>
      </button>
    </form>
  );
}
