// A row of the journeys query, for the tests of what is made of it. The defaults are a
// landing that shipped; each test says what differs.
export const HOUR = 3600;
export const T0 = 1_795_000_000;

export const row = (overrides = {}) => ({
  revision_id: 345001,
  bug_id: 2022026,
  job_id: 85061,
  stack_size: 2,
  stack_index: 1,
  requested_by: "alice",
  failed_attempts: 0,
  git_rev: "b".repeat(40),
  hg_rev: "e".repeat(40),
  autoland_rev: "a".repeat(40),
  central_rev: "c".repeat(40),
  merged_by: "sheriff-a",
  phab_created_s: T0 - 2 * 86400,
  phab_approved_s: T0 - HOUR,
  land_requested_s: T0,
  lando_started_s: T0 + 300,
  autoland_pushed_s: T0 + 420,
  merged_s: T0 + 6 * HOUR,
  autoland_ci_done_s: T0 + 420 + 2 * HOUR,
  central_ci_done_s: T0 + 9 * HOUR,
  nightly_started_s: T0 + 8 * HOUR,
  nightly_published_s: T0 + 10 * HOUR,
  nightly_decision_id: "d".repeat(22),
  nightly_last_task_id: "t".repeat(22),
  queue_closed_s: 0,
  autoland_closed_s: 1800,
  backed_out: false,
  backout_by: null,
  backout_s: null,
  lando_until_s: T0 + 30 * 86400,
  treeherder_until_s: T0 + 30 * 86400 + 4 * HOUR,
  fxci_until_s: T0 + 30 * 86400 + 11 * HOUR,
  commit_maps_until_s: T0 + 30 * 86400 - HOUR,
  ...overrides
});
