// Loads .env.local then .env into process.env for the server.
// MUST be imported before anything that reads process.env (first in index.ts).
// Precedence matches the old @next/env behavior: .env.local wins over .env
// (dotenv never overrides keys that are already set), and real environment
// variables (e.g. PORT=3001 on the command line) always win over both files.
import { config } from 'dotenv';

config({ path: ['.env.local', '.env'], quiet: true });
