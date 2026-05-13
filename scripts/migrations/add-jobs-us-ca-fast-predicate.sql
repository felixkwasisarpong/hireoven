-- Persists the strict US/CA location classification as a generated column on
-- jobs, plus a partial freshness index. Replaces the per-row regex predicate
-- that was scanning all 330K active jobs (~7s per feed query).
--
-- After this runs, lib/jobs/usa-job-sql.ts switches its SQL to filter on
-- `jobs.is_us_or_ca_strict = true` (or the H1B rescue path with companies join).
-- ADD COLUMN with a GENERATED expression auto-fills existing rows — this part
-- locks the table briefly (~30s–2min on 330K rows). CREATE INDEX is run
-- CONCURRENTLY to avoid blocking writes.

-- 1. Immutable, parallel-safe classifier function. Keep the regex content in
--    sync with lib/jobs/usa-job-sql.ts.
CREATE OR REPLACE FUNCTION job_location_is_us_ca_strict(loc text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT
    NOT COALESCE(loc, '') ~* '\m(united kingdom|u\.?k\.?|britain|england|scotland|wales|northern ireland|republic of ireland|ireland|europe|european union|emea|cee|nordics|germany|france|spain|italy|netherlands|holland|belgium|luxembourg|switzerland|austria|portugal|sweden|norway|denmark|finland|iceland|poland|czech republic|czechia|slovakia|hungary|romania|bulgaria|greece|croatia|slovenia|estonia|latvia|lithuania|ukraine|russia|apac|asia|asia pacific|anz|oceania|india|china|japan|south korea|korea|taiwan|hong kong|singapore|malaysia|thailand|indonesia|philippines|vietnam|pakistan|bangladesh|sri lanka|australia|new zealand|nepal|mena|middle east|africa|sub-saharan|israel|turkey|egypt|morocco|south africa|nigeria|kenya|u\.?a\.?e\.?|united arab emirates|saudi arabia|qatar|bahrain|oman|lebanon|jordan|latam|latin america|south america|brazil|mexico|argentina|chile|colombia|peru|uruguay|venezuela|ecuador|costa rica|panama|paraguay|bolivia|worldwide|anywhere|global|globally|international|bangalore|bengaluru|mumbai|new delhi|chennai|hyderabad|kolkata|ahmedabad|gurgaon|gurugram|noida|pune|kochi|jaipur|mohali|indore|coimbatore|trivandrum|thiruvananthapuram|visakhapatnam|beijing|shanghai|shenzhen|guangzhou|chongqing|tokyo|osaka|kyoto|yokohama|nagoya|fukuoka|krakow|gdansk|wroclaw|stockholm|copenhagen|helsinki|brussels|munich|frankfurt|barcelona|milan|prague|bucharest|budapest|sofia|reykjavik|zurich|amsterdam|dublin|lisbon|madrid|vienna|warsaw|kuala lumpur|bangkok|jakarta|manila|hanoi|ho chi minh|seoul|taipei|sao paulo|rio de janeiro|buenos aires|guadalajara|mexico city|bogota|bogotá|medellin|medellín|cali|cartagena|lima|santiago|quito|caracas|asuncion|montevideo|la paz|tel aviv|dubai|abu dhabi|riyadh|lagos|nairobi|cape town|johannesburg)\M'
    AND (
      COALESCE(loc, '') ~* '\m(usa?|u\.s\.?a?\.?|united states(?:\s+of\s+america)?|canada|north america|americas|amer)\M'
      OR COALESCE(loc, '') ILIKE '%, USA'
      OR COALESCE(loc, '') ILIKE '%, U.S.A.%'
      OR COALESCE(loc, '') ~* ',\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\s*([,\.]|$)'
      OR COALESCE(loc, '') ~* ',\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\s+\d{5}'
      OR COALESCE(loc, '') ~* '^US[\-,]\s*[A-Z]{2}[\-,]'
      OR COALESCE(loc, '') ~* '\m(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia|alberta|british columbia|manitoba|new brunswick|newfoundland and labrador|northwest territories|nova scotia|nunavut|ontario|prince edward island|quebec|saskatchewan|yukon)\M'
      OR COALESCE(loc, '') ~* '\m(san francisco|san francisco bay area|new york|new york city|los angeles|san diego|san jose|santa clara|mountain view|palo alto|menlo park|redwood city|sunnyvale|seattle|bellevue|redmond|austin|boston|cambridge|chicago|atlanta|dallas|houston|denver|raleigh|durham|phoenix|tempe|irvine|santa monica|sacramento|portland|miami|tampa|orlando|philadelphia|pittsburgh|minneapolis|madison|ann arbor|indianapolis|columbus|charlotte|jacksonville|las vegas|oklahoma city|salt lake city|kansas city|st louis|st\. louis|milwaukee|cleveland|cincinnati|detroit|baltimore|fort worth|el paso|memphis|nashville|louisville|new orleans|baton rouge|lafayette|toronto|vancouver|montreal|waterloo|ottawa|calgary|edmonton|mississauga|kitchener|winnipeg|hamilton|quebec city|halifax|victoria|regina|saskatoon)\M'
    )
$$;

-- 2. Generated stored column. ADD COLUMN backfills automatically; budget for
--    ~30s–2min on 330K rows during which writes to jobs are blocked.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS is_us_or_ca_strict BOOLEAN
    GENERATED ALWAYS AS (job_location_is_us_ca_strict(location)) STORED;

-- 3. Partial freshness index — covers the common feed query (sort by freshness,
--    filter to active US/CA jobs). Run CONCURRENTLY so writes aren't blocked.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_us_ca_active_freshest
  ON jobs (first_detected_at DESC NULLS LAST)
  WHERE is_active = true AND is_us_or_ca_strict = true;
