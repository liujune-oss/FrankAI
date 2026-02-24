// A simple log interceptor in route.ts
import fs from 'fs';

export function appendLog(msg: string) {
    try {
        fs.appendFileSync('rag_debug_log.txt', msg + '\n');
    } catch (e) { }
}
