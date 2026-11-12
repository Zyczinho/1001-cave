'use strict';
// DOWÓD for the guard pilot: "every City Route place has its Google photo".
// City Route may not store Google images (Google terms, SHARED_PLACES.md); a place shows
// its Google photo through the Worker when it has a confirmed Google place id. So the
// proof is: every place in data/cities/<city>/places.json has a valid id, by the same
// rule the app uses (catalogue-client.js applyGooglePlaceIds: id format + same name).
//
// Reads files only, no network, no keys. Lives in Rachet, outside the agent's repository.
// Usage: node city-route-google-photos.cjs <city-route folder>
// Exit 0 = done, 1 = not done yet (report on stdout), 2 = cannot check (not City Route).
const fs = require('node:fs');
const path = require('node:path');

const GOOGLE_PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
// The same fold as City Route core.js.
const fold = s => String(s ?? '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');
const CITY_NAMES = {warsaw: 'Warszawa', krakow: 'Kraków', lisbon: 'Lizbona'};

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function check(root) {
  const citiesDir = path.join(root, 'data', 'cities');
  if (!fs.existsSync(citiesDir)) return {error: 'To nie jest folder City Route (brak data/cities).'};
  const cities = [];
  for (const city of fs.readdirSync(citiesDir).sort()) {
    const placesFile = path.join(citiesDir, city, 'places.json');
    if (!fs.existsSync(placesFile)) continue;
    const places = readJson(placesFile);
    let ids = {};
    const idsFile = path.join(root, 'data', 'google-place-ids', city + '.json');
    if (fs.existsSync(idsFile)) {
      const file = readJson(idsFile);
      if (file?.places && typeof file.places === 'object') ids = file.places;
    }
    const missing = (Array.isArray(places) ? places : []).filter(p => {
      if (GOOGLE_PLACE_ID.test(String(p?.googlePlaceId || ''))) return false;
      const entry = Object.hasOwn(ids, p?.id) ? ids[p.id] : null;
      return !(entry && GOOGLE_PLACE_ID.test(String(entry.googlePlaceId || '')) && fold(entry.name) === fold(p?.name));
    });
    cities.push({city, total: Array.isArray(places) ? places.length : 0, missing});
  }
  if (!cities.length) return {error: 'Nie znaleziono żadnego data/cities/<miasto>/places.json.'};
  return {cities, missing: cities.reduce((n, c) => n + c.missing.length, 0), total: cities.reduce((n, c) => n + c.total, 0)};
}

function report(result) {
  if (result.error) return result.error;
  const per = result.cities.map(c => `${CITY_NAMES[c.city] || c.city} ${c.missing.length}/${c.total}`).join(', ');
  if (!result.missing) return `DOWÓD spełniony: wszystkie ${result.total} miejsc ma identyfikator Google (${per}).`;
  const lines = [`Bez identyfikatora Google: ${result.missing} z ${result.total} miejsc (${per}).`, 'Przykłady:'];
  for (const c of result.cities) for (const p of c.missing.slice(0, 5)) lines.push(`- ${CITY_NAMES[c.city] || c.city}: ${p.name} (${p.id})`);
  lines.push('Uzupełnij data/google-place-ids/<miasto>.json (wpis: id miejsca -> {googlePlaceId, name} z tą samą nazwą),',
    'np. przez scripts/collect-google-place-ids.mjs. Nie kopiuj zdjęć Google do repozytorium.');
  return lines.join('\n');
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || process.cwd());
  let result;
  try { result = check(root); } catch (e) { result = {error: 'Nie udało się odczytać danych: ' + e.message}; }
  process.stdout.write(report(result) + '\n');
  process.exitCode = result.error ? 2 : result.missing ? 1 : 0;
}

module.exports = {check, report, fold};
