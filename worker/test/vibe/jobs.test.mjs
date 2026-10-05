import test from 'node:test';
import assert from 'node:assert/strict';
import { JOBS_FILE, parseJobsFile, normalisedJobs, jobConnectorNames } from '../../lib/jobsfile.js';
import { SCHEMA_FILE } from '../../lib/dataschema.js';
import { MANIFEST_FILE } from '../../lib/connectors.js';
import { vibeProblems, injectSdk, VIBE_RULES } from '../../lib/vibe.js';
import { staticChecks } from '../../lib/checks.js';

const page = (js, head = '<script src="vibe.js"></script>') => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width">${head}</head><body><!--${'x'.repeat(250)}--><button onclick="go()">Go</button><script>${js}</script></body></html>`;
const AUTH = 'vibe.auth.ready.then(function(){ return vibe.auth.user(); });';
const READ = 'vibe.db.from("readings").select({ order: [{ col: "created_at", dir: "desc" }], limit: 24 }).then(function (r) { show(r.rows); }).catch(function (e) { show(e.status); });';
const schema = (access = 'public_read', extraCols = {}) => JSON.stringify({ version: 1, tables: { readings: { access, columns: { temp: { type: 'number' }, label: { type: 'text' }, ...extraCols } } } });
const conn = { host: 'api.example.com', paths: ['/v1/*'], methods: ['GET'] };
const manifest = JSON.stringify({ connectors: { stocks: conn } });
const nwsJob = (over = {}) => ({ id: 'hourly', schedule: { every: '1h' }, action: { type: 'connector', connector: 'nws', method: 'GET', path: '/gridpoints/TOP/31,80/forecast', save: { table: 'readings', map: { temp: '/properties/periods/0/temperature' } }, ...over } });
const jobs = (...list) => JSON.stringify({ version: 1, jobs: list.length ? list : [nwsJob()] });
const project = (over = {}) => ({ 'index.html': page(`${AUTH}${READ}`), [SCHEMA_FILE]: schema(), [JOBS_FILE]: jobs(), ...over });
const problems = (files) => vibeProblems(files, { enabled: true });
const one = (files, re) => { const p = problems(files); assert.equal(p.length, 1, p.join(' | ')); assert.match(p[0], re); return p[0]; };

// ---- the parser
test('JOBS_FILE is vibe.jobs.json', () => assert.equal(JOBS_FILE, 'vibe.jobs.json'));
test('a valid file with the schema and the built-in connector is accepted and normalised', () => {
    const r = parseJobsFile(jobs(), { spec: JSON.parse(schema()) });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.manifest, { version: 1, jobs: [nwsJob()] });
    assert.deepEqual(r.problems, []);
});
test('a prune job on a declared table is accepted, schedules every / dailyAt both work', () => {
    const spec = JSON.parse(schema());
    const prune = { id: 'tidy', schedule: { dailyAt: '03:30' }, action: { type: 'prune', table: 'readings', olderThanDays: 30 } };
    const r = parseJobsFile(jobs(prune, nwsJob({}) && { ...nwsJob(), id: 'b', schedule: { every: '15m' } }), { spec });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.deepEqual(r.manifest.jobs[0], { id: 'tidy', schedule: { dailyAt: '03:30', tz: 'UTC' }, action: { type: 'prune', table: 'readings', olderThanDays: 30 } });
});
test('declared connectors are available to jobs', () => {
    const f = nwsJob({ connector: 'stocks', path: '/v1/q' });
    const ok = parseJobsFile(jobs(f), { spec: JSON.parse(schema()), declared: ['stocks'] });
    assert.equal(ok.ok, true, JSON.stringify(ok.problems));
    const no = parseJobsFile(jobs(f), { spec: JSON.parse(schema()), declared: [] });
    assert.equal(no.ok, false);
    assert.match(no.problems.join(' '), /connector "stocks"/);
});
test('empty, oversized, non-JSON and non-object files are rejected without throwing', () => {
    const spec = JSON.parse(schema());
    for (const t of ['', undefined, null, '{nope', '[]', '"x"', 'null', '5']) { const r = parseJobsFile(t, { spec }); assert.equal(r.ok, false, String(t)); assert.equal(r.manifest, null); assert.ok(r.problems.length); }
    assert.match(parseJobsFile('', { spec }).problems[0], /empty/);
    assert.match(parseJobsFile('{nope', { spec }).problems[0], /not valid JSON/);
    assert.match(parseJobsFile(JSON.stringify({ jobs: [], pad: 'x'.repeat(17000) }), { spec }).problems[0], /too large/);
});
test('a file with no jobs is a problem (remove it)', () => {
    const r = parseJobsFile(JSON.stringify({ version: 1, jobs: [] }), { spec: JSON.parse(schema()) });
    assert.equal(r.ok, false); assert.match(r.problems[0], /declares no jobs/);
});
test('without a usable schema, a jobs file is a problem that says so', () => {
    const r = parseJobsFile(jobs(), { spec: null });
    assert.equal(r.ok, false); assert.match(r.problems.join(' '), /vibe\.schema\.json/);
});

const BAD = [
    ['not_an_object', null, /must be a JSON object/],
    ['unknown_key', (j) => { j.extra = 1; }, /key that is not allowed/],
    ['bad_version', (j) => { j.version = 2; }, /version must be 1/],
    ['no_jobs', (j) => { delete j.jobs; }, /"jobs" list/],
    ['too_many_jobs', (j) => { j.jobs = Array.from({ length: 6 }, (_, i) => ({ ...nwsJob(), id: `j${i}` })); }, /too many jobs \(max 5\)/],
    ['bad_job', (j) => { j.jobs = [5]; }, /each job must be an object/],
    ['bad_job_id', (j) => { j.jobs[0].id = 'Bad Id'; }, /job id/],
    ['duplicate_job_id', (j) => { j.jobs.push({ ...nwsJob() }); }, /duplicate job id/],
    ['bad_schedule', (j) => { j.jobs[0].schedule = { every: '5s' }; }, /schedule must be \{"every":/],
    ['bad_action', (j) => { j.jobs[0].action = { type: 'sql' }; }, /action type must be/],
    ['not_yet', (j) => { j.jobs[0].action = { type: 'notify', text: 'hi' }; }, /notify jobs are not supported yet/],
    ['unknown_table', (j) => { j.jobs[0].action.save.table = 'nope'; }, /table "nope" is not declared in vibe\.schema\.json/],
    ['bad_table', (j) => { j.jobs[0].action.save.table = 'Bad-Table'; }, /table name/],
    ['bad_older_than_days', (j) => { j.jobs[0].action = { type: 'prune', table: 'readings', olderThanDays: 0 }; }, /olderThanDays must be a whole number from 1 to 365/],
    ['bad_connector', (j) => { j.jobs[0].action.connector = 'Bad Name'; }, /connector name/],
    ['unknown_connector', (j) => { j.jobs[0].action.connector = 'weather'; }, /connector "weather" does not exist/],
    ['bad_method', (j) => { j.jobs[0].action.method = 'POST'; }, /method must be "GET"/],
    ['bad_path', (j) => { j.jobs[0].action.path = 'forecast'; }, /path must start with \//],
    ['bad_query', (j) => { j.jobs[0].action.query = { a: { b: 1 } }; }, /query must be/],
    ['bad_save', (j) => { delete j.jobs[0].action.save; }, /save must be/],
    ['reserved_column', (j) => { j.jobs[0].action.save.map.user_id = '/x'; }, /id, user_id and created_at/],
    ['bad_column', (j) => { j.jobs[0].action.save.map['Bad Col'] = '/x'; }, /column name/],
    ['unknown_column', (j) => { j.jobs[0].action.save.map.nope = '/x'; }, /column "nope" of table "readings" is not declared/],
    ['bad_pointer', (j) => { j.jobs[0].action.save.map.temp = 'properties.temp'; }, /JSON pointer/],
    ['missing_required_column', (j) => { j.jobs[0].action.save.map = { label: '/x' }; }, /required column "temp"/],
];
for (const [code, mutate, re] of BAD) {
    test(`validator code ${code} becomes a specific message`, () => {
        const j = JSON.parse(jobs());
        const spec = JSON.parse(schema('public_read', { }));
        if (code === 'missing_required_column') spec.tables.readings.columns.temp.required = true;
        const input = mutate === null ? '5' : (mutate(j), JSON.stringify(j));
        const r = parseJobsFile(input, { spec });
        assert.equal(r.ok, false);
        assert.ok(r.problems.some((p) => re.test(p)), `${code}: ${r.problems.join(' | ')}`);
        assert.ok(r.problems.every((p) => /^vibe\.jobs\.json/.test(p)), r.problems.join(' | '));
        assert.ok(!r.problems.some((p) => /is invalid$/.test(p)), `generic fallback used for ${code}`);
    });
}
test('problems name the job and are capped', () => {
    const j = JSON.parse(jobs()); j.jobs[0].action.save.map = { nope1: '/a', nope2: '/b' }; j.jobs[0].schedule = { every: '9s' };
    const r = parseJobsFile(JSON.stringify(j), { spec: JSON.parse(schema()) });
    assert.ok(r.problems.some((p) => /job "hourly"/.test(p)), r.problems.join(' | '));
    const many = JSON.parse(jobs()); many.jobs = Array.from({ length: 5 }, (_, i) => ({ id: `j${i}`, schedule: { every: 'x' }, action: { type: 'sql' } }));
    assert.ok(parseJobsFile(JSON.stringify(many), { spec: JSON.parse(schema()) }).problems.length <= 10);
});
test('model-written text never leaks into problem messages beyond names that look like names', () => {
    const j = JSON.parse(jobs()); j.jobs[0].action.save.table = 'x'.repeat(80) + '<script>';
    const r = parseJobsFile(JSON.stringify(j), { spec: JSON.parse(schema()) });
    assert.ok(r.problems.every((p) => !p.includes('<script>')), r.problems.join(' | '));
});
test('a job that saves into an owner table is a problem: job rows have no user_id so nobody could read them', () => {
    const r = parseJobsFile(jobs(), { spec: JSON.parse(schema('owner')) });
    assert.equal(r.ok, false);
    assert.match(r.problems[0], /table "readings"/); assert.match(r.problems[0], /no user_id/); assert.match(r.problems[0], /public_read or authenticated/);
    for (const access of ['public_read', 'authenticated']) assert.equal(parseJobsFile(jobs(), { spec: JSON.parse(schema(access)) }).ok, true, access);
});
test('prune on an owner table is fine (it deletes, it does not need to be read)', () => {
    const prune = { id: 'tidy', schedule: { every: '1d' }, action: { type: 'prune', table: 'readings', olderThanDays: 7 } };
    assert.equal(parseJobsFile(jobs(prune), { spec: JSON.parse(schema('owner')) }).ok, true);
});
test('jobConnectorNames lists connectors of connector jobs only, tolerating junk', () => {
    assert.deepEqual(jobConnectorNames(JSON.stringify({ jobs: [nwsJob(), { action: { type: 'prune', table: 't', olderThanDays: 1 } }, nwsJob({ connector: 'stocks' }), null, 5, { action: null }] })).sort(), ['nws', 'stocks']);
    for (const t of [undefined, '', '{nope', '[]', '{"jobs":5}']) assert.deepEqual(jobConnectorNames(t), []);
});

// ---- vibeProblems integration
test('a weather logger project with schema, job and a reader has no problems; staticChecks agrees', () => {
    assert.deepEqual(problems(project()), []);
    assert.equal(staticChecks(project(), { vibe: true }).ok, true);
});
test('a jobs-only change does not need the app to call vibe.api', () => {
    assert.ok(!/vibe\.api/.test(project()['index.html']));
    assert.deepEqual(problems(project()), []);
});
test('a declared connector that only a job uses is not reported as never called', () => {
    const f = project({ [MANIFEST_FILE]: manifest, [JOBS_FILE]: jobs(nwsJob({ connector: 'stocks', path: '/v1/q' })) });
    assert.deepEqual(problems(f), []);
});
test('a declared connector that neither a job nor the app uses is still reported', () => {
    one(project({ [MANIFEST_FILE]: manifest }), /declares connector "stocks" but the app never calls it/);
});
test('an invalid jobs file is reported once with the file name', () => {
    one(project({ [JOBS_FILE]: '{nope' }), /vibe\.jobs\.json is not valid JSON/);
});
test('a job saving to a table missing from the schema is a problem naming the table', () => {
    const f = project({ [JOBS_FILE]: jobs(nwsJob({ save: { table: 'logs', map: { temp: '/a' } } })) });
    const p = problems(f);
    assert.ok(p.some((x) => /table "logs" is not declared in vibe\.schema\.json/.test(x)), p.join(' | '));
});
test('a job with an unknown connector is a problem', () => {
    one(project({ [JOBS_FILE]: jobs(nwsJob({ connector: 'weather' })) }), /connector "weather" does not exist/);
});
test('a notify job is a problem saying notify jobs are not supported yet', () => {
    one(project({ [JOBS_FILE]: jobs({ id: 'ping', schedule: { every: '1d' }, action: { type: 'notify', text: 'hi' } }) }), /notify jobs are not supported yet/);
});
test('an owner table written by a job is a problem that tells the model to change the access', () => {
    one(project({ [SCHEMA_FILE]: schema('owner') }), /public_read or authenticated/);
});
test('a jobs file without a schema file is a problem (and the missing-schema message is not duplicated)', () => {
    const f = project(); delete f[SCHEMA_FILE];
    const p = problems(f);
    assert.ok(p.some((x) => /vibe\.jobs\.json needs vibe\.schema\.json/.test(x)), p.join(' | '));
});
test('with an invalid schema, the schema problem is reported and the jobs file adds no table noise', () => {
    const p = problems(project({ [SCHEMA_FILE]: '{nope' }));
    assert.ok(p.some((x) => /vibe\.schema\.json is not valid JSON/.test(x)), p.join(' | '));
    assert.ok(!p.some((x) => /not declared/.test(x)), p.join(' | '));
});
test('a jobs file that is not at the project root is a problem', () => {
    const f = project(); f['app/vibe.jobs.json'] = f[JOBS_FILE]; delete f[JOBS_FILE];
    const p = problems(f);
    assert.ok(p.some((x) => /vibe\.jobs\.json must be at the project root, not at app\/vibe\.jobs\.json/.test(x)), p.join(' | '));
});
test('when the proxy is off a jobs file is a problem and nothing else about jobs is said', () => {
    const p = vibeProblems({ 'index.html': page('var x=1;'), [JOBS_FILE]: jobs() }, { enabled: false });
    assert.equal(p.length, 1); assert.match(p[0], /vibe\.jobs\.json is not available here/);
});
test('a project that only has a jobs file (no use of vibe in code) is still checked', () => {
    const p = problems({ 'index.html': page('var x=1;', ''), [JOBS_FILE]: jobs() });
    assert.ok(p.length >= 1);
    assert.ok(p.some((x) => /vibe\.schema\.json/.test(x)), p.join(' | '));
});
test('jobs written rows must be read: a schema table used only by a job and never by vibe.db is reported by the schema check', () => {
    const f = project({ 'index.html': page('var x=1;', '') });
    const p = problems(f);
    assert.ok(p.some((x) => /never calls vibe\.db/.test(x)), p.join(' | '));
});

// ---- the shipped bundle
test('injectSdk keeps a valid jobs file, normalised, only at the root with a valid schema and the proxy on', () => {
    const f = project();
    const out = injectSdk(f, { sdk: 'SDK', enabled: true });
    assert.deepEqual(JSON.parse(out[JOBS_FILE]), { version: 1, jobs: [nwsJob()] });
    assert.ok(out[JOBS_FILE].endsWith('\n'));
    assert.ok(SCHEMA_FILE in out);
    assert.equal(JOBS_FILE in injectSdk(f, { sdk: 'SDK', enabled: false }), false);
    assert.equal(JOBS_FILE in injectSdk({ ...f, [JOBS_FILE]: '{nope' }, { sdk: 'SDK', enabled: true }), false);
    assert.equal(JOBS_FILE in injectSdk({ ...f, [SCHEMA_FILE]: '{nope' }, { sdk: 'SDK', enabled: true }), false);
    const g = { ...f }; delete g[SCHEMA_FILE];
    assert.equal(JOBS_FILE in injectSdk(g, { sdk: 'SDK', enabled: true }), false);
    const h = { ...f, 'app/vibe.jobs.json': f[JOBS_FILE] }; delete h[JOBS_FILE];
    assert.equal('app/vibe.jobs.json' in injectSdk(h, { sdk: 'SDK', enabled: true }), false);
    assert.equal(JOBS_FILE in injectSdk({ ...f, [SCHEMA_FILE]: schema('owner') }, { sdk: 'SDK', enabled: true }), false);
});
test('normalisedJobs returns null for anything not valid', () => {
    assert.equal(normalisedJobs({ [JOBS_FILE]: jobs() }), null);
    assert.ok(normalisedJobs({ [JOBS_FILE]: jobs(), [SCHEMA_FILE]: schema() }));
    assert.equal(normalisedJobs({ [JOBS_FILE]: 'x', [SCHEMA_FILE]: schema() }), null);
    assert.equal(normalisedJobs({}), null);
});

// ---- what the model is taught
test('the rules teach scheduled jobs: when, format, notify not supported, reading rows back, access', () => {
    for (const re of [
        /vibe\.jobs\.json/,
        /periodic|refresh/i,
        /prun/i,
        /"every":"1h"|every.{0,40}15m.{0,20}1h.{0,20}6h.{0,20}1d/s,
        /dailyAt/,
        /UTC/,
        /"type":"connector"/, /"type":"prune"/,
        /save/, /"map"/, /JSON pointer|\/properties\//,
        /at most 5 jobs/i,
        /notify jobs (?:are )?not (?:supported|available)/i,
        /not_yet|not supported yet/i,
        /no user_id/i,
        /public_read or authenticated|public_read.{0,30}authenticated/,
        /never "owner"|not "owner"|not owner/i,
        /vibe\.db\.from/,
        /near real time|not real time|minutes late|delayed/i,
        /(?:other|every) (?:column|field)/i,
    ]) assert.match(VIBE_RULES, re);
});
