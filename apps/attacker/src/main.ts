import './load-env.js';
import { loadConfig } from './config.js';
import { createControlServer } from './server.js';

const config = loadConfig();
const server = createControlServer(config);

server.listen(config.port, '0.0.0.0', () => {
  console.log(`LoadForge attacker listening on http://localhost:${config.port}`);
  console.log(`target (fixed): ${config.target}`);
  console.log(`limits: rate <= ${config.maxRate}/s, duration <= ${config.maxDurationSec}s`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
