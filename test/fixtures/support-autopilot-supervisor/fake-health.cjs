import { existsSync, readFileSync } from "node:fs";

const heartbeatPath = process.env.SUPPORT_AUTOPILOT_TEST_HEARTBEAT_PATH;
const runnerLastSeenAt = heartbeatPath && existsSync(heartbeatPath)
  ? readFileSync(heartbeatPath, "utf8").trim()
  : null;

process.stdout.write(JSON.stringify({
  activeLeases: 0,
  claimsEnabled: true,
  gatesReady: true,
  jobCreationEnabled: true,
  pendingJobs: 0,
  privacyGatePassed: true,
  reachable: true,
  runnerFresh: true,
  runnerLastSeenAt,
  runnerReady: true,
  shadowModeEnabled: true,
}) + "\n");
