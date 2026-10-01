import { existsSync } from 'node:fs';

// Imported first in main.ts so .env is loaded before other modules read process.env.
if (existsSync('.env')) process.loadEnvFile('.env');
