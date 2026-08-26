export const dynamic = "force-dynamic";

// Owner login (2026-08-24, Rees's spec) -- see lib/owner-cookie.ts for the
// full mechanism writeup. Deliberately reachable pre-auth (middleware.ts
// allowlists it for guests) or nobody could ever log in.
export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <div style={{ maxWidth: 320, margin: "5rem auto", padding: "0 1rem" }}>
      <h1
        style={{
          fontFamily: "var(--font-display), system-ui, sans-serif",
          fontSize: "1.25rem",
          fontWeight: 700,
          color: "var(--color-navy)",
          marginBottom: "1rem",
        }}
      >
        Owner Login
      </h1>
      <form method="POST" action="/api/login" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          style={{
            padding: "0.5rem 0.625rem",
            border: "1px solid var(--color-border, #ddd5c8)",
            borderRadius: "var(--radius-sm, 4px)",
            fontSize: "0.9375rem",
            background: "var(--color-surface)",
            color: "var(--color-text)",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "0.5rem 0.625rem",
            border: "none",
            borderRadius: "var(--radius-sm, 4px)",
            background: "var(--color-navy)",
            color: "#fff",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Log in
        </button>
      </form>
      {searchParams.error && (
        <p style={{ color: "#dc2626", fontSize: "0.875rem", marginTop: "0.75rem" }}>Incorrect password.</p>
      )}
    </div>
  );
}
