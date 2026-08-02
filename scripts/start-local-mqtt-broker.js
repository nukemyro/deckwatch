const http = require('http');
const { Aedes } = require('aedes');
const ws = require('websocket-stream');

const port = Number(process.env.MQTT_PORT || 9001);
const broker = new Aedes();
const server = http.createServer();

ws.createServer({ server }, function(stream) {
  const client = broker.handle(stream);
  stream.on('error', () => {});
  stream.on('close', () => {
    if (client && typeof client.close === 'function') {
      client.close();
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`MQTT WebSocket broker listening on ws://0.0.0.0:${port}`);
});
