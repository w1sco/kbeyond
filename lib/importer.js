async function speichereBlock(events) {
  if (events.length === 0) return;

  // Rekonstruierte Doppelgänger entfernen (gleicher Spieler, gleiche Minute)
  const mitSpieler = events.filter((e) => e.player_id);
  if (mitSpieler.length > 0) {
    await sql`
      DELETE FROM events
      WHERE id LIKE 'rk\_%'
        AND (league_id, player_id, date_trunc('minute', dt)) IN (
          SELECT * FROM UNNEST(
            ${mitSpieler.map((e) => e.league_id)}::text[],
            ${mitSpieler.map((e) => e.player_id)}::text[],
            ${mitSpieler.map((e) => new Date(e.dt).toISOString().slice(0, 16) + ":00Z")}::timestamptz[]
          )
        )`;
  }

  await sql`
    INSERT INTO events (id, league_id, type, dt, buyer, seller, price, player_id, player_name, raw)
    SELECT * FROM UNNEST(
      ${events.map((e) => e.id)}::text[],
      ${events.map((e) => e.league_id)}::text[],
      ${events.map((e) => e.type)}::int[],
      ${events.map((e) => e.dt)}::timestamptz[],
      ${events.map((e) => e.buyer)}::text[],
      ${events.map((e) => e.seller)}::text[],
      ${events.map((e) => e.price)}::bigint[],
      ${events.map((e) => e.player_id)}::text[],
      ${events.map((e) => e.player_name)}::text[],
      ${events.map((e) => e.raw)}::jsonb[]
    )
    ON CONFLICT (id) DO NOTHING`;
}
