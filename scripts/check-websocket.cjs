const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9001');
ws.on('open', () => {
  console.log('ws open');
  ws.close();
});
ws.on('error', (err) => {
  console.error('ws error', err.message);
  process.exit(1);
});
