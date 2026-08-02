const mqtt = require('mqtt');

const client = mqtt.connect('ws://127.0.0.1:9001', {
  clientId: 'deckwatch-publish-local',
  clean: true,
  connectTimeout: 10000,
  keepalive: 30
});

client.on('connect', () => {
  console.log('connected');
  client.subscribe('reolink/+/events', (err) => {
    if (err) {
      console.error('subscribe error', err);
      process.exit(1);
    }

    const payload = {
      deviceId: 'reolink_camera',
      timestamp: Date.now(),
      eventType: 'motion',
      label: 'motion-detected',
      confidence: 0.98
    };

    client.publish('reolink/+/events', JSON.stringify(payload), { qos: 0, retain: false }, (publishErr) => {
      console.log(publishErr ? 'publish error' : 'published');
      client.end(true);
    });
  });
});

client.on('error', (err) => {
  console.error('client error', err);
  process.exit(1);
});
