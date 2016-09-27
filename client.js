
const EventEmitter = require('events').EventEmitter
const util = require('util')
const eos = require('end-of-stream')
const ws = require('websocket-stream')
const pump = require('pump')
const reemit = require('re-emitter')
const protobufs = require('sendy-protobufs').ws
const debug = require('debug')('tradle:ws:client')
const Wire = require('@tradle/wire')
const createBackoff = require('backoff')
const utils = require('./utils')
const createManager = require('./manager')
const schema = protobufs.schema

module.exports = Client

function Client (opts) {
  const self = this

  EventEmitter.call(this)

  this._opts = opts
  this._openSocket = this._openSocket.bind(this)
  this._manager = createManager()
  this._manager._createWire = function () {
    return self._createWire.apply(self, arguments)
  }

  reemit(this._manager, this, createManager.WIRE_EVENTS)

  this._queues = []
  this._backoff = opts.backoff || createBackoff.exponential({
    initialDelay: 1000,
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
  return new Wire({ plaintext: true })
}

Client.prototype.send = function (recipient, msg, cb) {
  if (!this._manager.hasWire(recipient)) {
    this._setupWire(recipient)
  }

  this._manager.send(recipient, msg, cb)

  if (!this._queues[recipient]) this._queues[recipient] = []
  this._queues[recipient].push(arguments)
}

Client.prototype.ack = function (recipient, msg) {
  const seq = msg.seq || seq
  const wire = this._wires[recipient]
  if (wire) return wire.ack(seq)
}

Client.prototype._setupWire = function (recipient) {
  const wire = this._manager.wire(recipient)
  pump(
    wire,
    utils.encoder(recipient),
    this._socket,
    utils.decoder(recipient),
    wire
  )
}

Client.prototype._debug = function () {
  var args = [].slice.call(arguments)
  args.unshift(this._opts.url)
  return debug.apply(null, arguments)
}

Client.prototype._openSocket = function () {
  const self = this
  if (this._socket) this._debug('reconnecting')

  this._socket = ws(this._opts.url)
  eos(this._socket, function () {
    if (self._destroyed) return
    if (self._destroying) {
      self._debug('destroyed')
      self._destroying = false
      self._destroyed = true
      return self.emit('destroy')
    }

    debug('backing off before reconnecting')
    self._backoff.backoff()
  })

  this._manager.reset()
  for (var recipient in this._queues) {
    var q = this._queues[recipient].slice()
    this._queues[recipient].length = 0
    for (var i = 0; i < q.length; i++) {
      this.send.apply(this, q[i])
    }
  }
}

Client.prototype.destroy = function (cb) {
  if (this._destroyed) return process.nextTick(cb)

  this._destroying = true
  if (cb) this.once('destroy', cb)

  this._socket.end()
}

function toBuffer (obj) {
  if (Buffer.isBuffer(obj)) return obj
  if (typeof obj === 'string') return new Buffer(obj)
  return new Buffer(JSON.stringify(obj))
}
