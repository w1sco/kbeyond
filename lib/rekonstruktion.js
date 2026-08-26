export async function rekonstruiere(leagueId, token, stichtag, opt = {}) {
  const { zeitbudgetMs = 45000, abIndex = 0 } = opt;
  const beginn = Date.now();

  const cache = await sql`SELECT daten FROM pool_cache WHERE id = 'bundesliga'`;
  let spieler;
  if (cache[0]?.daten?.spieler && Date.now() - new Date(cache[0].daten.stand) < 86_400_000) {
    spieler = cache[0].daten.spieler;
  } else {
    spieler = await holeSpielerPool(token);
    const inhalt = JSON.stringify({ stand: new Date(), spieler });
    await sql`
      INSERT INTO pool_cache (id, daten) VALUES ('bundesliga', ${inhalt}::jsonb)
      ON CONFLICT (id) DO UPDATE SET daten = ${inhalt}::jsonb`;
  }

  // Vorhandene Transfers als Fingerabdruck: Spieler + Zeitpunkt (auf die Minute)
  const vorhanden = new Set(
    (await sql`
      SELECT player_id, dt FROM events
      WHERE league_id = ${leagueId} AND type = 15 AND player_id IS NOT NULL`
    ).map((r) => `${r.player_id}|${new Date(r.dt).toISOString().slice(0, 16)}`)
  );

  let index = abIndex;
  let neu = 0;
  let uebersprungen = 0;
  let geprueft = 0;

  while (index < spieler.length) {
    if (Date.now() - beginn > zeitbudgetMs) break;

    const s = spieler[index];
    try {
      const hist = await kbGet(`/v4/leagues/${leagueId}/players/${s.id}/transferHistory`, token);
      const alle = historieZuTransfers(leagueId, s.id, s.name, hist, stichtag);

      const frisch = alle.filter((t) => {
        const key = `${t.player_id}|${new Date(t.dt).toISOString().slice(0, 16)}`;
        if (vorhanden.has(key)) { uebersprungen++; return false; }
        vorhanden.add(key);
        return true;
      });

      await speichereBlock(frisch);
      neu += frisch.length;
    } catch {
      // Spieler überspringen
    }

    geprueft++;
    index++;
    await schlaf(200);
  }

  return {
    neu,
    uebersprungen,
    geprueft,
    index,
    gesamt: spieler.length,
    fertig: index >= spieler.length,
  };
}
