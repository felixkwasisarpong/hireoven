-- Migration: add-oflc-wage-levels
-- Official OFLC prevailing-wage level tables (ALC_Export.csv + Geography.csv), shipped
-- annually on 1 July inside https://flag.dol.gov/sites/default/files/wages/OFLC_Wages_<YY-YY>.zip
--
-- WHY: lib/stay/wage-level-query.ts currently *infers* Level II/III/IV cutoffs from the p05 of
-- certified LCA filings at SOC x STATE grain. That is an approximation of a number DOL publishes
-- exactly, at SOC x OEWS-AREA grain. Under the wage-weighted H-1B lottery (eff. 27 Feb 2026) the
-- level literally sets a registrant's entry count, so the exact threshold is the product.
--
-- MEASURED against the real 2026-27 file (do not re-derive these by hand):
--   * ALC_Export.csv = 449,440 rows = 530 areas x 848 SOC codes, ZERO duplicate (Area, SocCode).
--   * 442,919 rows carry all four levels. The other 6,521 are exactly the rows whose `Label` is
--     'High Wage' (5,866) or 'No Leveled Wage' (655) -- those have blank levels and are SKIPPED.
--   * `Label` = 'Annual Wage' (32,299 rows) means the row is already annual; a BLANK label
--     (410,620 rows) means the row is HOURLY. Do NOT infer the unit from magnitude.
--   * Level2/Level3 are linear interpolations, not percentiles:
--       Level2 = Level1 + (Level4-Level1)/3 ; Level3 = Level1 + 2*(Level4-Level1)/3
--     Max observed deviation across all 442,919 usable rows: $0.34 (DOL whole-dollar rounding).
--
-- We store every wage ANNUALIZED (hourly x 2080) so consumers never re-derive units, and keep
-- `source_unit` for provenance. `wage_year` is in the PK so a new July file loads alongside the
-- old one and cuts over atomically.
--
-- APPLY:
--   psql "$DATABASE_URL" -f scripts/migrations/add-oflc-wage-levels.sql
--   npm run oflc:import          # then loads the data

-- ---------------------------------------------------------------------------
-- Wage levels: the payload. One row per (wage year, OEWS area, SOC code).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oflc_wage_levels (
  wage_year   TEXT     NOT NULL,           -- '2026-27'
  area        TEXT     NOT NULL,           -- OEWS area code, e.g. '47900'. 6-7 digits = nonmetro.
  soc_code    TEXT     NOT NULL,           -- '15-1252'
  geo_lvl     SMALLINT,                    -- DOL geography level (1-4)
  level1      INTEGER  NOT NULL,           -- annual USD
  level2      INTEGER  NOT NULL,
  level3      INTEGER  NOT NULL,
  level4      INTEGER  NOT NULL,
  average     INTEGER,                     -- OEWS mean, annual USD (nullable: blank on some rows)
  source_unit TEXT     NOT NULL,           -- 'hourly' | 'annual' (as published)
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wage_year, area, soc_code)
);

-- Primary read path is (area, soc_code) for the newest wage_year.
CREATE INDEX IF NOT EXISTS oflc_wage_levels_area_soc_idx
  ON oflc_wage_levels (area, soc_code);
CREATE INDEX IF NOT EXISTS oflc_wage_levels_soc_idx
  ON oflc_wage_levels (soc_code);

-- ---------------------------------------------------------------------------
-- Geography: county -> area. 3,275 rows, 530 distinct areas.
-- NOTE: 2,023 of these rows are 6- and 7-digit BLS *nonmetropolitan* codes that have no CBSA
-- equivalent, which is why we resolve county -> area from THIS file and never ZIP -> CBSA.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oflc_area_counties (
  wage_year        TEXT NOT NULL,
  area             TEXT NOT NULL,
  state_ab         TEXT NOT NULL,          -- 'VA'
  county_town_name TEXT NOT NULL,          -- 'Fairfax County' (as published)
  county_norm      TEXT NOT NULL,          -- 'fairfax' -- lowercased, county/parish/borough stripped
  area_name        TEXT NOT NULL,          -- 'Washington-Arlington-Alexandria, DC-VA-MD-WV'
  PRIMARY KEY (wage_year, area, state_ab, county_town_name)
);

CREATE INDEX IF NOT EXISTS oflc_area_counties_lookup_idx
  ON oflc_area_counties (wage_year, state_ab, county_norm);

-- ---------------------------------------------------------------------------
-- Principal cities parsed out of AreaName, so a free-text job location ("Austin, TX") can reach
-- an area without a city->county crosswalk. 'Washington-Arlington-Alexandria, DC-VA-MD-WV' yields
-- washington / arlington / alexandria, each paired with every state in the area's state list.
-- `name_rank` = position in the hyphenated name (0 = principal city) so ties resolve to the
-- larger/leading city. This is a HEURISTIC layer -- county match always wins over it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oflc_area_cities (
  wage_year TEXT     NOT NULL,
  state_ab  TEXT     NOT NULL,
  city_norm TEXT     NOT NULL,             -- 'arlington'
  area      TEXT     NOT NULL,
  area_name TEXT     NOT NULL,
  name_rank SMALLINT NOT NULL,
  PRIMARY KEY (wage_year, state_ab, city_norm, area)
);

CREATE INDEX IF NOT EXISTS oflc_area_cities_lookup_idx
  ON oflc_area_cities (wage_year, state_ab, city_norm, name_rank);

-- ---------------------------------------------------------------------------
-- SOC reference titles, for title -> SOC classification. Sourced from oes_soc_occs.csv (official
-- title + description) UNIONed with xwalk_plus.csv (O*NET alternate titles per SOC), which is what
-- makes "Sr. Associate Software Development Engineer" reachable from '15-1252'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oflc_soc_titles (
  soc_code   TEXT NOT NULL,
  title      TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  source     TEXT NOT NULL,                -- 'oes' | 'onet'
  PRIMARY KEY (soc_code, title_norm)
);

CREATE INDEX IF NOT EXISTS oflc_soc_titles_norm_idx
  ON oflc_soc_titles (title_norm);

-- ---------------------------------------------------------------------------
-- Title -> SOC lexicon, derived from our own certified LCA filings.
--
-- WHY NOT the official crosswalk: xwalk_plus.csv in the 2026-27 archive carries only 997 rows
-- for 848 SOC codes -- essentially one official title each ('15-1252' -> 'Software Developers').
-- Real req titles ('Sr. Associate Software Development Engineer') never match it. lca_records
-- gives us 359,966 filings pairing an EMPLOYER-WRITTEN job title with the SOC that DOL accepted,
-- in exactly our title distribution. That is the right training corpus.
--
-- MEASURED on 100k active jobs with a parsed salary band:
--   exact normalized-title match  -> 11.0% resolved
--   longest token-phrase match    -> 56.3% resolved   <- what we ship
-- Of the resolved rows, ~92% land in specialty-occupation major groups (11/13/15/17/19/25/27/29),
-- which is the only population the lottery card is shown to. The unresolved remainder is
-- dominated by retail/food/service titles ('store crew', 'cashier') that are not H-1B-sponsorable
-- and correctly get no card.
--
-- CRITICAL: lca_records.soc_code carries the O*NET suffix ('15-1252.00') while ALC_Export.csv
-- uses the bare SOC ('15-1252'). We store LEFT(soc_code, 7) so this table joins to
-- oflc_wage_levels directly. Joining the raw values matches ZERO rows.
--
-- Populated by: npm run soc:lexicon:apply  (scripts/build-soc-lexicon.ts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS soc_title_lexicon (
  title_norm  TEXT     NOT NULL PRIMARY KEY,  -- 'software engineer' (seniority stripped)
  soc_code    TEXT     NOT NULL,              -- '15-1252' -- bare, joins to oflc_wage_levels
  token_count SMALLINT NOT NULL,              -- phrase length; longer = more specific = preferred
  support     INTEGER  NOT NULL,              -- LCA filings backing this title
  share       NUMERIC  NOT NULL,              -- majority SOC's share of that title's filings
  built_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup is by exact phrase, then we prefer the longest match.
CREATE INDEX IF NOT EXISTS soc_title_lexicon_len_idx
  ON soc_title_lexicon (token_count DESC);
