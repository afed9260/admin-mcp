import { existsSync, writeFileSync } from "node:fs";

const drainPath = process.env.SUPPORT_AUTOPILOT_DRAIN_REQUEST_PATH;
const heartbeatPath = process.env.SUPPORT_AUTOPILOT_TEST_HEARTBEAT_PATH;
if (heartbeatPath) writeFileSync(heartbeatPath, new Date().toISOString(), "utf8");
process.stderr.write(JSON.stringify({ eventCode: "shadow_runner_ready" }) + "\n");
setInterval(() => {
  if (drainPath && existsSync(drainPath)) process.exit(0);
}, 25);
