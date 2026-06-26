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
    <section>
      <h1>Sign in</h1>
      <p className="muted">Access your verified daily account action plan.</p>
      {error ? (
        <p className="badge tag-warn" role="alert">
          {error}
        </p>
      ) : null}
      <form action="/auth/login" method="post" className="card" style={{ maxWidth: 380 }}>
        <input type="hidden" name="redirectTo" value={redirectTo ?? "/dashboard"} />
        <label style={{ display: "block", marginBottom: 8 }}>
          Email
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </section>
  );
}
