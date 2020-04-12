# serve-buffer

**Serve a [`Buffer`](https://nodejs.org/api/buffer.html#buffer_class_buffer) via HTTP, with [`Range`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Range) and [conditional `GET`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match) support.** Monkey-patches [`send`](https://github.com/pillarjs/send) to allow serving in-memory data.

[![npm version](https://img.shields.io/npm/v/serve-buffer.svg)](https://www.npmjs.com/package/serve-buffer)
[![build status](https://api.travis-ci.org/derhuerst/serve-buffer.svg?branch=master)](https://travis-ci.org/derhuerst/serve-buffer)
![ISC-licensed](https://img.shields.io/github/license/derhuerst/serve-buffer.svg)
![minimum Node.js version](https://img.shields.io/node/v/serve-buffer.svg)
[![chat with me on Gitter](https://img.shields.io/badge/chat%20with%20me-on%20gitter-512e92.svg)](https://gitter.im/derhuerst)
[![support me on Patreon](https://img.shields.io/badge/support%20me-on%20patreon-fa7664.svg)](https://patreon.com/derhuerst)


## Installation

```shell
npm install serve-buffer
```


## Usage

```js
const express = require('express')
const serveBuffer = require('serve-buffer')

const app = express()
const serve = serveBuffer()
app.use('/data', serve)

let data = Buffer.from('a lot of data here…', 'utf8')
serve.setBuffer(data)

// change buffer later
data.writeInt8(123, 1)
serve.bufferHasChanged()

// replace entire buffer later
data = Buffer.from('entirely different buffer', 'utf8')
serve.setBuffer(data)
```


## API

```js
const serve = serveBuffer(opt = {})
serve.bufferHasChanged(newTimeModified = new Date())
serve.setBuffer(newBuf, newTimeModified = new Date())
```

`opt` overrides the default config, which looks like this:

```js
{
	contentType: 'application/octect-stream',
	getETag: buf => require('etag')(buf),
}
```


## Related

- [`send`](https://github.com/pillarjs/send) – Streaming static file server with Range and conditional-GET support
- [`http-file-response`](https://github.com/mafintosh/http-file-response) – Send a file back as a HTTP response with support for range queries etc.


## Contributing

If you have a question or need support using `serve-buffer`, please double-check your code and setup first. If you think you have found a bug or want to propose a feature, use [the issues page](https://github.com/derhuerst/serve-buffer/issues).
