import { WebSocketServer } from 'ws';
import { SocksClient } from 'socks';
import net from 'net';

export function startBridge({ port, proxy }) {
  const wss = new WebSocketServer({ port });
  console.log(`[bridge] Listening on ws://localhost:${port}`);
  console.log(`[bridge] Route: ${proxy ? `SOCKS5 ${proxy.ip}:${proxy.port}` : 'direct TCP'}`);

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[bridge] WS client from ${clientIp}`);

    let tcpSocket = null;
    let bytesIn = 0;
    let bytesOut = 0;
    let handshakeDone = false;

    ws.on('message', async (data) => {
      if (!handshakeDone) {
        const text = data.toString('utf8');
        let ip, port;
        try {
          const parsed = JSON.parse(text);
          ip = parsed.ip;
          port = parseInt(parsed.port, 10);
        } catch {
          if (text.includes(':')) {
            const sep = text.lastIndexOf(':');
            ip = text.slice(0, sep);
            port = parseInt(text.slice(sep + 1), 10);
          } else {
            ip = text;
            port = 443;
          }
        }
        if (!ip || !Number.isFinite(port)) {
          if (ws.readyState === ws.OPEN) {
            ws.send(`error:bad target format: ${text}`);
            ws.close(1008);
          }
          return;
        }
        console.log(`[bridge] Target ${ip}:${port}`);

        try {
          if (proxy) {
            const info = await SocksClient.createConnection({
              proxy: {
                host: proxy.ip,
                port: proxy.port,
                type: proxy.socksType || 5,
                userId: proxy.username,
                password: proxy.password
              },
              command: 'connect',
              timeout: 10000,
              destination: { host: ip, port }
            });
            tcpSocket = info.socket;
          } else {
            tcpSocket = new net.Socket();
            await new Promise((resolve, reject) => {
              tcpSocket.connect(port, ip, resolve);
              tcpSocket.on('error', reject);
            });
          }

          tcpSocket.on('data', (chunk) => {
            bytesOut += chunk.length;
            if (ws.readyState === ws.OPEN) ws.send(chunk);
          });

          tcpSocket.on('close', () => {
            console.log(`[bridge] TCP closed (in=${bytesIn}, out=${bytesOut})`);
            ws.close();
          });

          tcpSocket.on('error', (err) => {
            console.error(`[bridge] TCP error: ${err.message}`);
            if (ws.readyState === ws.OPEN) ws.close(1011, err.message);
          });

          handshakeDone = true;
          ws.send('ok');
          console.log(`[bridge] Connected, ACK sent`);
        } catch (err) {
          console.error(`[bridge] Connect failed: ${err.message}`);
          if (ws.readyState === ws.OPEN) {
            ws.send(`error:${err.message}`);
            ws.close(1011);
          }
        }
        return;
      }

      bytesIn += data.length;
      if (tcpSocket && !tcpSocket.destroyed) tcpSocket.write(data);
    });

    ws.on('close', () => {
      console.log(`[bridge] WS closed (in=${bytesIn}, out=${bytesOut})`);
      if (tcpSocket && !tcpSocket.destroyed) tcpSocket.destroy();
    });

    ws.on('error', (err) => {
      console.error(`[bridge] WS error: ${err.message}`);
    });
  });

  return wss;
}
