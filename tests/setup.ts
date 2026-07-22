import { setLogLevel } from '../src/lib/logger.js';

setLogLevel('error');

// Keep unit tests from writing durable experiment dumps under ~/.cursor/logdump.
process.env.OBSIDIAN_CONTEXT_LOGDUMP ??= 'false';
