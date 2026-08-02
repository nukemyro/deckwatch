const mqtt = require('mqtt');
const topic = 'reolink/+/events';
const subscriber = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
  clientId: 'subscriber-' + Date.now(),
  clean: true,
  protocolVersion: 4,
  connectTimeout: 10000,
  keepalive: 30
});
subscriber.on('connect', () => {
  subscriber.subscribe(topic, (err) => {
    if (err) {
      console.error('subscribe-error', err.message);
      subscriber.end(true);
      return;
    }
    console.log('subscribed');
  });
});
subscriber.on('message', (receivedTopic, message) => {
  console.log('received', receivedTopic, message.toString());
  subscriber.end(true);
});
subscriber.on('error', (err) => {
  console.error('subscriber-error', err.message);
  subscriber.end(true);
});
setTimeout(() => {
  const publisher = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
    clientId: 'publisher-' + Date.now(),
    clean: true,
    protocolVersion: 4,
    connectTimeout: 10000,
    keepalive: 30
  });
  publisher.on('connect', () => {
    const payload = JSON.stringify({ deviceId: 'reolink_camera', timestamp: Date.now(), eventType: 'motion', label: 'motion-detected', confidence: 0.98 });
    publisher.publish(topic, payload, { qos: 0, retain: false }, (err) => {
      console.log(err ? 'publish-error' : 'published');
      publisher.end(true);
    });
  });
}, 2000);
