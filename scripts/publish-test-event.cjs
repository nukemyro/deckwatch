const mqtt = require('mqtt');
const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
  clientId: 'deckwatch-publish-' + Date.now(),
  clean: true,
  protocolVersion: 4,
  connectTimeout: 10000,
  keepalive: 30
});
client.on('connect', () => {
  const payload = {
    deviceId: 'reolink_camera',
    timestamp: Date.now(),
    eventType: 'motion',
    label: 'motion-detected',
    confidence: 0.98
  };
  client.publish('reolink/+/events', JSON.stringify(payload), { qos: 0, retain: false }, (err) => {
    console.log(err ? 'publish-error' : 'published');
    client.end(true);
  });
});
client.on('error', (err) => {
  console.error('publish-error', err.message);
  client.end(true);
});
