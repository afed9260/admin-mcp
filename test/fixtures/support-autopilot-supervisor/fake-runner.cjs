import { existsSync } from "node:fs";

const drainPath = process.env.SUPPORT_AUTOPILOT_DRAIN_REQUEST_PATH;
process.stderr.write(JSON.stringify({ eventCode: "shadow_runner_ready" }) + "\n");
setInterval(() => {
  if (drainPath && existsSync(drainPath)) process.exit(0);
}, 25);
