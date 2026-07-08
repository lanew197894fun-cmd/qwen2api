import { startProxy, PROXY_PORT } from "./src/chat-proxy.js";
const srv = await startProxy();
console.log("plugin-started proxy on", PROXY_PORT);
setTimeout(() => { console.log("ALIVE after 40s"); process.exit(0); }, 40000);
