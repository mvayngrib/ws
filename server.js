
const parseUrl = require('url').parse
const querystring = require('querystring')
const EventEmitter = require('events').EventEmitter
const eos = require('end-of-stream')
const pump = require('pump')
const websocket = require('websocket-stream')
const reemit = require('re-emitter')
const through = require('through2')
const debug = require('debug')('tradle:ws:server')
// const duplexify = require('duplexify')
const Wire = require('@tradle/wire')
const utils = require('./utils')
const createManager = require('./manager')
const DEFAULT_WIRE_OPTS = { plaintext: true }

module.exports = function createServer (opts) {
  const wsServer = websocket.createServer(opts, onconnection)
  const streams = {}
  const proxies = {}
  const manager = createManager()
  const ee = new EventEmitter()

  var closed

  /** override this */
  ee._createWire = function (recipient) {
    return new Wire({ plaintext: true })
  }

  manager._createWire = function (recipient) {
    const wire = ee._createWire(recipient)
    wire._debugId = 'server-wire-' + wire._debugId
    wire.cork()
    return wire
  }

  ee.hasClient = function (from) {
    return from in streams
  }

  ee.send = manager.send.bind(manager)
  ee.ack = manager.ack.bind(manager)
  ee.close = function (cb) {
    if (closed) throw new Error('already closed')

    closed = true
    manager.destroy()
    wsServer.close(cb)
  }

  ee.destroy = wsServer.close.bind(wsServer)

  wsServer.once('close', ee.close)
  return ee

  function onconnection (stream) {
    stream.on('error', function () {
      debug('stream experienced error', err)
      stream.end()
    })

    if (closed) {
      debug('already closed, terminating incoming connection')
      return stream.end()
    }

    const url = stream.socket.upgradeReq.url
    const query = querystring.parse(parseUrl(url).query)
    const from = query.from
    if (streams[from]) {
      debug(`ignoring second stream from ${from}`)
      return stream.end()
    }

    debug(`${from} connected`)
    streams[from] = stream
    const wire = manager.wire(from)
    pump(
      stream,
      utils.decoder(),
      takeData(),
      wire,
      utils.encoder({ from: opts.identifier }),
      stream,
      function (err) {
        if (err) {
          debug('stream ended with error', err)
          stream.end()
        }

        delete streams[from]

        // wire.end()
        // delete wires[from]
        if (!closed) {
          debug(`${from} disconnected`)
          ee.emit('disconnect', from)
        }
      }
    )

    wire.uncork()
    wire.resume()
    reemit(manager, ee, createManager.WIRE_EVENTS)
    ee.emit('connect', from)
  }
}

function takeData () {
  return through.obj(function (packet, enc, cb) {
    cb(null, packet.data)
  })
}
