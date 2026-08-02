const mqtt = require('mqtt');
const client = mqtt.connect('ws://broker.hivemq.com:8000/mqtt', {
  clientId: 'node-hivemq-' + Date.now(),
  clean: false,
  protocolVersion: 4,
  connectTimeout: 20000,
  keepalive: 60
});
client.on('connect', () => {
  console.log('connected');
});
client.on('offline', () => {
  console.log('offline');
});
client.on('close', () => {
  console.log('closed');
});
client.on('error', (err) => {
  console.log('error', err.message);
});
setTimeout(() => {
  client.end(true);
  console.log('ended');
}, 15000);
