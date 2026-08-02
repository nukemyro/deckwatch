const http = require('http');
const aedesLib = require('aedes');
const websocket = require('websocket-stream');

const broker = new aedesLib.Aedes();
const server = http.createServer();

websocket.createServer({ server }, (stream) => {
  broker.handle(stream);
});

server.listen(9001, '127.0.0.1', () => {
  console.log('MQTT broker listening on ws://127.0.0.1:9001');
});
