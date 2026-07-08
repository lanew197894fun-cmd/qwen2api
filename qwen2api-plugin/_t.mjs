import { startProxy } from "./src/chat-proxy.js";
await startProxy();
import fs from "node:fs";
fs.writeFileSync(
  "/tmp/ka_marker.txt",
  "STARTED " + new Date().toISOString() + "\n",
);
