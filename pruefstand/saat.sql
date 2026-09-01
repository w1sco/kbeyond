-- Daten für den Prüfstand. Bewusst mit den Fällen, die schon mal
-- Fehler ausgelöst haben: ein Manager mit Datenlücke, Käufe mit und ohne
-- auffindbaren Marktwert, ein Spieler ohne Namen, Transfers zwischen
-- Managern und vom Markt.

TRUNCATE events, liga_settings, korrektur, import_log, teamwerte,
         teamwert_verlauf, kader, markt_beobachtung, marktwert_verlauf,
         marktwert_geprueft, pool_cache, rekon_log;

INSERT INTO liga_settings (league_id, user_id, stichtag, startbudget, punkte_bonus, login_aktiv)
VALUES ('1', '1', '2026-08-07 00:41+02', 200000000, 10000, TRUE),
       ('1', '',  '2026-08-07 00:41+02', 200000000, 10000, TRUE);

INSERT INTO korrektur (league_id, user_id, manager, betrag)
VALUES ('1', '1', 'PetzS', -500000);

-- Angebote am Markt (Typ 3) und Käufe (Typ 15)
INSERT INTO events (id, league_id, type, dt, buyer, seller, price, player_id, player_name, raw) VALUES
 ('a1','1',3, NOW() - '9 days'::interval,  NULL, NULL, NULL, '201','Jonathan Tah','{"mv":30000000}'),
 ('k1','1',15,NOW() - '9 days'::interval + '6 hours'::interval,'W1zco', NULL, 33000000,'201','Jonathan Tah','{}'),
 ('a2','1',3, NOW() - '7 days'::interval,  NULL, NULL, NULL, '204','Ermedin Demirovic','{"mv":42000000}'),
 ('k2','1',15,NOW() - '7 days'::interval + '4 hours'::interval,'yannick15',NULL,50000000,'204','Ermedin Demirovic','{}'),
 -- Kauf ohne auffindbares Angebot: bleibt in der Aufschlagsrechnung außen vor
 ('k3','1',15,NOW() - '5 days'::interval,'yannick15',NULL, 9000000,'205','Robin Zentner','{}'),
 -- Deal zwischen zwei Managern
 ('k4','1',15,NOW() - '3 days'::interval,'PetzS','W1zco', 20000000,'206','Nadiem Amiri','{}'),
 -- Verkauf an Kickbase: macht den Spieler wieder frei
 ('v1','1',15,NOW() - '3 days'::interval,NULL,'W1zco', 12000000,'301','Freier Stürmer','{}'),
 -- Spieler, der zweimal am Markt war → Rhythmus messbar
 ('a3','1',3, NOW() - '17 days'::interval, NULL,NULL,NULL,'302','Freier Verteidiger','{"mv":8500000}'),
 ('a4','1',3, NOW() - '3 days'::interval,  NULL,NULL,NULL,'302','Freier Verteidiger','{"mv":9000000}'),
 -- Login-Bonus und eine Strafe
 ('b1','1',22,NOW() - '2 days'::interval, NULL,NULL,NULL,NULL,NULL,'{"bn":100000,"day":13}'),
 ('s1','1',29,NOW() - '4 days'::interval, NULL,NULL,NULL,NULL,NULL,'{"amt":-250000,"n":"PetzS","adt":"Regelverstoß"}');

INSERT INTO import_log (league_id, letzter_lauf, neue_events, gesamt, offset_pos, komplett)
VALUES ('1', NOW() - '5 minutes'::interval, 0, 11, 0, TRUE);

INSERT INTO teamwerte (league_id, manager_id, teamwert, spieler, stand) VALUES
 ('1','1',180000000,3,NOW() - '20 minutes'::interval),
 ('1','2',165000000,2,NOW() - '20 minutes'::interval),
 ('1','3',150000000,1,NOW() - '20 minutes'::interval);

INSERT INTO teamwert_verlauf (league_id, manager_id, teamwert, stand) VALUES
 ('1','1',176000000,NOW() - '3 days'::interval),
 ('1','1',179000000,NOW() - '2 days'::interval),
 ('1','1',180000000,NOW() - '20 minutes'::interval),
 ('1','2',170000000,NOW() - '2 days'::interval),
 ('1','2',165000000,NOW() - '20 minutes'::interval);

INSERT INTO kader (league_id, manager_id, player_id, name, position, marktwert, kaufpreis, punkte, stand) VALUES
 ('1','1','201','Jonathan Tah','ABW',32200000,30000000,288,NOW() - '20 minutes'::interval),
 ('1','1','202','Manuel Neuer','TW', 21900000,22700000,312,NOW() - '20 minutes'::interval),
 ('1','1','203','Nadiem Amiri','MF', 12500000,11000000,201,NOW() - '20 minutes'::interval),
 ('1','2','204','Ermedin Demirovic','ANG',44200000,50000000,401,NOW() - '20 minutes'::interval),
 -- Spieler ohne Namen: prüft die Rückfallebene "Spieler #…"
 ('1','2','205',NULL,'TW',8900000,7000000,150,NOW() - '20 minutes'::interval),
 ('1','3','206','Nadiem Amiri','MF',15100000,14000000,190,NOW() - '20 minutes'::interval);

INSERT INTO markt_beobachtung (league_id, player_id, ablauf, gesehen, marktwert) VALUES
 ('1','302',NOW() + '10 hours'::interval, NOW() - '2 hours'::interval, 9000000);

INSERT INTO rekon_log (league_id, position, fertig, letzter, gefunden)
VALUES ('1', 0, TRUE, NOW() - '1 day'::interval, 0);

-- Marktwert-Mitschrift: zwei Marktwert-Tage, damit der MW-Trend rechnen kann.
-- Mit Ecken: 203 steht nur an einem Tag drin (zählt also nicht mit), und
-- 206 hat einen unveränderten Wert (Trend genau 0).
INSERT INTO mw_beobachtung (player_id, tag, marktwert) VALUES
 ('201', (NOW() - '1 day'::interval)::date, 32700000),
 ('201', NOW()::date,                       32200000),   -- -500 Tsd
 ('202', (NOW() - '1 day'::interval)::date, 21500000),
 ('202', NOW()::date,                       21900000),   -- +400 Tsd
 ('203', NOW()::date,                       12500000),   -- nur ein Tag → zählt nicht
 ('204', (NOW() - '1 day'::interval)::date, 44900000),
 ('204', NOW()::date,                       44200000),   -- -700 Tsd
 ('206', (NOW() - '1 day'::interval)::date, 15100000),
 ('206', NOW()::date,                       15100000);   -- ±0

-- Spielplan: zwei gewertete Spieltage und drei kommende.
-- Die Vereins-IDs sind dieselben wie im Spielerpool der Attrappe
-- (2 Stuttgart, 3 Leverkusen, 7 Bayern) plus einer, den der Pool NICHT
-- kennt (99) - damit sich zeigt, dass ein unbekannter Gegner sauber
-- ausgewiesen und nicht geraten wird.
INSERT INTO spiele (spieltag, heim, gast, punkte_heim, punkte_gast) VALUES
  (1, '7', '99', 900, 300),
  (1, '3',  '2', 600, 600),
  (2, '99', '3', 400, 800),
  (2, '2',  '7', 500, 700),
  (3, '7',  '3', NULL, NULL),
  (3, '2', '99', NULL, NULL),
  (4, '99', '7', NULL, NULL),
  (4, '3',  '2', NULL, NULL),
  (5, '7',  '2', NULL, NULL)
ON CONFLICT DO NOTHING;
