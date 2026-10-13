// Runs once, before Jest starts any test workers.
//
// Pins the time zone for the whole test run, so date tests give the same result on every machine.
// It has to happen here: a test file that sets process.env.TZ only changes its own sandboxed copy
// of process.env, not the zone its Date objects use.
//
// West of UTC on purpose: there, new Date('2026-10-12') (midnight UTC) is still 11 October locally,
// so code that reads a 'YYYY-MM-DD' date with local getters fails the tests instead of passing by luck
// (as it would in UTC, the usual zone on CI servers).
module.exports = () => {
  process.env.TZ = 'America/Los_Angeles';
};
