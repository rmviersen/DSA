"use client";

export function TeamFilter({
  teams,
  selectedOrgId,
  action,
}: {
  teams: { id: number; name: string; nickname: string }[];
  selectedOrgId?: number;
  action: string;
}) {
  return (
    <form method="get" action={action}>
      <select name="team" defaultValue={selectedOrgId ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        <option value="">All teams</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} {t.nickname}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit">Filter</button>
      </noscript>
    </form>
  );
}
