const mqtt = require('mqtt');
const urls = [
  'ws://broker.hivemq.com:8000/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://mqtt.eclipseprojects.io:443/mqtt',
  'ws://broker.emqx.io:8083/mqtt'
];

(async () => {
  for (const url of urls) {
    const client = mqtt.connect(url, {
      clientId: 'probe-' + Date.now(),
      clean: true,
      protocolVersion: 4,
      connectTimeout: 10000,
      keepalive: 30
    });

    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        client.end(true);
        resolve('timeout');
      }, 12000);

      client.on('connect', () => {
        clearTimeout(timer);
        client.end(true);
        resolve('connected');
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        resolve(err.message || 'error');
      });
    });

    console.log(url, '=>', result);
  }
})();
