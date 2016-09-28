
const EventEmitter = require('events').EventEmitter
const util = require('util')
const eos = require('end-of-stream')
const ws = require('websocket-stream/stream')
const pump = require('pump')
const through = require('through2')
const reemit = require('re-emitter')
const protobufs = require('sendy-protobufs').ws
const debug = require('debug')('tradle:ws:client')
const Wire = require('@tradle/wire')
const createBackoff = require('backoff')
const duplexify = require('duplexify')
const utils = require('./utils')
const createManager = require('./manager')
const schema = protobufs.schema

module.exports = Client

function Client (opts) {
  const self = this

  EventEmitter.call(this)
  if (typeof opts === 'string') {
    opts = { url: opts }
  }

  this._opts = opts
  this._url = opts.url
  this._openSocket = this._openSocket.bind(this)
  this._onSocketClose = this._onSocketClose.bind(this)
  this._manager = createManager()
  this._manager._createWire = function () {
    return self._createWire.apply(self, arguments)
  }

  reemit(this._manager, this, createManager.WIRE_EVENTS)

  this._backoff = opts.backoff || createBackoff.exponential({
    initialDelay: 200,
    maxDelay: 10000
  })

  this._backoff.on('ready', this._openSocket)
  this._openSocket()
}

util.inherits(Client, EventEmitter)

/**
 * Overwrite this
 */
Client.prototype._createWire = function () {
  const wire = new Wire({ plaintext: true })
  wire._debugId = 'client-wire-' + wire._debugId
  return wire
}

Client.prototype.send = function (recipient, msg, cb) {
  this._setupWire(recipient)
  this._manager.send(recipient, msg, cb)
}

Client.prototype.ack = function (recipient, msg) {
  this._manager.ack(recipient, msg)
}

Client.prototype._setupWire = function (recipient) {
  const self = this
  if (this._manager.hasWire(recipient)) return

  const wire = this._manager.wire(recipient).resume()
  // wire.on('pause', () => console.log('wire paused'))
  // wire.on('data', data => console.log('sending', data.length))
  // wire.pause()
  pump(
    wire,
    utils.encoder({ to: recipient }),
    this._socket || this._getProxy()
  )

  wire.uncork()
}

Client.prototype._getProxy = function () {
  if (!this._proxy) this._proxy = duplexify()

  return this._proxy
}

Client.prototype._debug = function () {
  var args = [].slice.call(arguments)
  args.unshift(this._url)
  return debug.apply(null, arguments)
}

Client.prototype._openSocket = function () {
  const self = this
  if (this._socket) this._debug('reconnecting')

  this._debug('connecting to ' + this._url)
  this._socket = ws(this._url)
  if (this._proxy) {
    this._proxy.setReadable(this._socket)
    this._proxy.setWritable(this._socket)
  }

  this._socket.on('error', function () {
    self._socket.end()
  })

  this._socket.once('connect', function () {
    self.emit('connect')
  })

  pump(
    this._socket,
    utils.decoder(),
    through.obj(function (packet, enc, cb) {
      self._setupWire(packet.from)
      self._manager.wire(packet.from).write(packet.data)
      cb()
    }),
    this._onSocketClose
  )
}

Client.prototype._onSocketClose = function (err) {
  if (err) this._debug('experienced error ' + JSON.stringify(err))
  if (this._destroyed) return
  if (this._destroying) {
    this._debug('destroyed')
    this._destroying = false
    this._destroyed = true
    return this.emit('destroy')
  }

  debug('backing off before reconnecting')
  this._socket = null
  this._proxy = null
  this._backoff.backoff()
  this._manager.reset()
  this.emit('disconnect')
}

Client.prototype.destroy = function (cb) {
  if (this._destroyed) return process.nextTick(cb)

  this._destroying = true
  if (cb) this.once('destroy', cb)

  this._manager.destroy()
  this._socket.end()
}
