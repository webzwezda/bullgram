import { WebSocket as WsClient } from 'ws';
import { Mutex } from 'async-mutex';

const BRIDGE_URL = process.env.BRIDGE_URL || 'ws://localhost:8765';

const closeError = new Error('BullrunBridgeSocket was closed');

export class BullrunBridgeSocket {
  constructor() {
    this.client = undefined;
    this.stream = Buffer.alloc(0);
    this.closed = true;
    this._mutex = new Mutex();
    this._handshakeDone = false;
  }

  async readExactly(number) {
    let readData = Buffer.alloc(0);
    while (true) {
      const thisTime = await this.read(number);
      readData = Buffer.concat([readData, thisTime]);
      number = number - thisTime.length;
      if (!number || number === -437) return readData;
    }
  }

  async read(number) {
    if (this.closed) throw closeError;
    await this.canRead;
    if (this.closed) throw closeError;
    const toReturn = this.stream.slice(0, number);
    this.stream = this.stream.slice(number);
    if (this.stream.length === 0) {
      this.canRead = new Promise((resolve) => { this.resolveRead = resolve; });
    }
    return toReturn;
  }

  async readAll() {
    if (this.closed || !(await this.canRead)) throw closeError;
    const toReturn = this.stream;
    this.stream = Buffer.alloc(0);
    this.canRead = new Promise((resolve) => { this.resolveRead = resolve; });
    return toReturn;
  }

  async connect(port, ip) {
    this.stream = Buffer.alloc(0);
    this.canRead = new Promise((resolve) => { this.resolveRead = resolve; });
    this.closed = false;
    this._handshakeDone = false;

    const url = BRIDGE_URL;
    console.log(`[socket] Connecting to bridge ${url} (target ${ip}:${port})`);
    this.client = new WsClient(url);

    return new Promise((resolve, reject) => {
      this.client.on('open', () => {
        this.client.send(JSON.stringify({ ip, port }));
      });

      this.client.on('message', async (data) => {
        if (!this._handshakeDone) {
          const text = data.toString('utf8');
          if (text === 'ok') {
            this._handshakeDone = true;
            console.log(`[socket] Bridge ACK received`);
            resolve(this);
          } else if (text.startsWith('error:')) {
            reject(new Error(text.slice(6)));
          }
          return;
        }

        const release = await this._mutex.acquire();
        try {
          this.stream = Buffer.concat([this.stream, data]);
          if (this.resolveRead) this.resolveRead(true);
        } finally {
          release();
        }
      });

      this.client.on('error', (err) => {
        console.error(`[socket] WS error: ${err.message}`);
        if (!this._handshakeDone) reject(err);
      });

      this.client.on('close', () => {
        if (this.resolveRead) this.resolveRead(false);
        this.closed = true;
      });
    });
  }

  write(data) {
    if (this.closed) throw closeError;
    if (this.client) this.client.send(data);
  }

  async close() {
    if (this.client) this.client.close();
    this.closed = true;
  }

  toString() {
    return 'BullrunBridgeSocket';
  }
}
