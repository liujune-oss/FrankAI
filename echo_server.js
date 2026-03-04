const http = require('http');
const server = http.createServer((req, res) => {
  console.log([ECHO] \ \);
  console.log('Headers:', req.headers);
  
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    console.log('Body length:', body.length);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*'
    });
    res.end(JSON.stringify({ transcript: '这是一个测试语音' }));
  });
});
server.listen(3005, () => console.log('Echo server on 3005'));
