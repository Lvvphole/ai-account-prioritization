/**
 * Sign-in page. Posts to the /auth/login route handler, which sets the Supabase
 * session cookies and redirects. Local dev users are seeded in supabase/seed.sql.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}) {
  const { redirectTo, error } = await searchParams;

  return (
    <div className="auth">
      <div className="auth-card">
        <h1>Sign in</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Access your verified daily account action plan.
        </p>
        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
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
      </div>
    </div>
  );
}
