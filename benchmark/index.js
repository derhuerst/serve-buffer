'use strict'

const execa = require('execa')
const chalk = require('chalk')
const {request} = require('http')

const exitWithError = (err) => {
	console.error(err)
	process.exit(1)
}

const execaOpts = {
	stdin: null,
	stdout: 'inherit',
	stderr: 'inherit',
	stripFinalNewline: false,
}

const serverProcess = execa.node(require.resolve('./server'), {
	stdin: null,
	stripFinalNewline: false,
})
serverProcess.stdout.on('data', d => console.log(d + ''))
serverProcess.catch(exitWithError)

;(async () => {
	await new Promise(r => setTimeout(r, 1000, null))

	const res = await new Promise((resolve, reject) => {
		const req = request('http://localhost:3000/', {method: 'HEAD'}, resolve)
		req.once('error', reject)
		req.end()
	})
	const {etag} = res.headers

	const variants = [
		[
			{name: 'GET', cols: {method: 'GET'}, flags: []},
			{name: 'HEAD', cols: {method: 'HEAD'}, flags: ['-m', 'HEAD']},
		], [
			{name: 'no KeepAlive', cols: {KeepAlive: 'no'}, flags: []},
			{name: 'with KeepAlive', cols: {KeepAlive: 'yes'}, flags: ['-k']},
		], [
			{name: '2 connections', cols: {connections: '2'}, flags: ['-c', '2']},
			{name: '10 connections', cols: {connections: '10'}, flags: ['-c', '10']},
		], [
			{name: 'full body', cols: {range: 'full'}, flags: []},
			{name: 'range 20-70', cols: {range: '20-70'}, flags: ['-H', 'range: bytes=20-70']},
			{name: 'range -50', cols: {range: '-50'}, flags: ['-H', 'range: bytes=-50']},
			{name: 'range 50-', cols: {range: '50-'}, flags: ['-H', 'range: bytes=50-']},
		], [
			{name: 'no ETag', cols: {ETag: 'no'}, flags: []},
			{name: 'with ETag', cols: {ETag: 'yes'}, flags: ['-H', `if-none-match: ${etag}`]},
		], [
			{name: 'no compression', cols: {compression: 'none'}, flags: []},
			{name: 'with gzip', cols: {compression: 'gzip'}, flags: ['-H', 'accept-encoding: gzip']},
			{name: 'with brotli', cols: {compression: 'brotli'}, flags: ['-H', 'accept-encoding: br']},
		],
	]

	let benchmarks = variants[0].map(({name, cols, flags}) => ({name: [name], cols, flags}))
	for (const flagVariants of variants.slice(1)) {
		benchmarks = benchmarks.flatMap(({name, cols, flags}) => {
			return flagVariants.map(({name: _name, cols: _cols, flags: _flags}) => ({
				name: [...name, _name],
				cols: {...cols, ..._cols},
				flags: [...flags, ..._flags],
			}))
		})
	}
	benchmarks = benchmarks.map(({name, cols, flags}) => ({
		name: name.join(', '),
		cols,
		flags,
	}))
	const estDur = benchmarks.length * 5
	process.stdout.write(`${benchmarks.length} benchmarks, estimated duration ~${estDur}s\n`)

	process.stdout.write(`warming server's v8 JIT\n`)
	await execa('ab', ['-q', '-d', '-t', '5', '-c', '10', 'http://[::]:3000/'], {
		...execaOpts,
		stdout: null,
	})

	for (const {name, cols, flags} of benchmarks) {
		process.stdout.write(`\n\n\n${chalk.underline(name)}\n\n`)

		await execa('ab', ['-q', '-d', '-t 5', ...flags, 'http://[::]:3000/'], execaOpts)
	}

	serverProcess.kill('SIGTERM')
})()
.catch(exitWithError)
