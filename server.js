
const parseUrl = require('url').parse
const querystring = require('querystring')
const EventEmitter = require('events').EventEmitter
const eos = require('end-of-stream')
const pump = require('pump')
const websocket = require('websocket-stream')
const reemit = require('re-emitter')
const debug = require('debug')('tradle:ws:server')
const Wire = require('@tradle/wire')
const utils = require('./utils')
const createManager = require('./manager')
const DEFAULT_WIRE_OPTS = { plaintext: true }

module.exports = function createServer (opts) {
  const wsServer = websocket.createServer(opts, onconnection)
  const streams = {}
  const manager = createManager()
  const ee = new EventEmitter()

  var closed

  /** override this */
  ee._createWire = function (recipient) {
    return new Wire({ plaintext: true })
  }

  manager._createWire = function () {
    return ee._createWire.apply(ee, arguments)
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
      utils.decoder(from),
      wire,
      utils.encoder(from),
      stream,
      function (err) {
        if (err) stream.end()

        delete streams[from]

        // wire.end()
        // delete wires[from]
        if (!closed) {
          debug(`${from} disconnected`)
          ee.emit('disconnect', from)
        }
      }
    )

    reemit(manager, ee, createManager.WIRE_EVENTS)
    ee.emit('connect', from)
  }
}
