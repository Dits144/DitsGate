import { createApp } from './app.mjs';
const port = Number(process.env.DITSGATE_API_PORT || 5180);
const host = process.env.DITSGATE_HOST || '127.0.0.1';
const allowOrigin = process.env.DITSGATE_ALLOW_ORIGIN || 'http://127.0.0.1:5179';
const { server } = createApp({ allowOrigin });
server.listen(port, host, () => console.log(`DitsGate API: http://${host}:${port} (origin: ${allowOrigin})`));
