const mosca = require('mosca');
const settings = { port: 9001, http: { port: 9002, bundle: true, static: false } };
const broker = new mosca.Server(settings);

broker.on('ready', () => {
  console.log('broker ready');
});

broker.on('error', (err) => {
  console.error('broker error', err);
  process.exit(1);
});
