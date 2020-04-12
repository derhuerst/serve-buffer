'use strict'

const {createServer} = require('http')
const {randomBytes} = require('crypto')
const serveBuffer = require('.')

const serveBuf = serveBuffer()
let data = Buffer.from('0123456789', 'utf8')
serveBuf.setBuffer(data)

// change buffer later
setInterval(() => {
	const patch = randomBytes(3)
	patch.copy(data)
	serveBuf.bufferHasChanged()
})

createServer(serveBuf).listen(3000, (err) => {
	if (err) {
		console.error(err)
		process.exit(1)
	}

	console.info(`\
listening on port 3000
try fetching data via curl 'http://localhost:3000/'`)
})
