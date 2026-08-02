const mqtt = require('mqtt');
const client = mqtt.connect('wss://test.mosquitto.org:8081/mqtt', {
  clientId: 'node-check-' + Date.now(),
  clean: true,
  connectTimeout: 20000,
  keepalive: 60,
  protocolVersion: 4
});
client.on('connect', () => {
  console.log('connected');
});
client.on('reconnect', () => {
  console.log('reconnect');
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
  console.log('timeout');
  client.end(true);
}, 30000);
