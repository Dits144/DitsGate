import { createApp } from './app.mjs';
const port=Number(process.env.DITSGATE_API_PORT||5180);
const {server}=createApp();
server.listen(port,'127.0.0.1',()=>console.log(`DitsGate local sandbox API: http://127.0.0.1:${port}`));
