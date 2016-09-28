const EventEmitter = require('events').EventEmitter
const eos = require('end-of-stream')
const debug = require('debug')('tradle:ws:manager')
const utils = require('./utils')
const noop = function () {}
const WIRE_EVENTS = ['request', 'message', 'handshake', 'ack', 'error']

exports = module.exports = createManager
exports.WIRE_EVENTS = WIRE_EVENTS

function createManager (opts) {
  opts = opts || {}

  const ackCache = {}
  var wires = {}
  var callbacks = {}
  var queues = {}
  var destroying
  var destroyed

  const manager = new EventEmitter()
  manager._read = function () {}
  manager.reset = function () {
    // don't reset ackCache
    for (var recipient in wires) {
      wires[recipient].end()
    }

    callbacks = {}
    wires = {}

    var qcopy = queues
    queues = {}
    for (var recipient in qcopy) {
      var q = qcopy[recipient]
      for (var i = 0; i < q.length; i++) {
        manager.send.apply(manager, q[i])
      }
    }
  }

  manager.hasWire = function (recipient) {
    return recipient in wires
  }

  manager.wire = function (recipient) {
    if (wires[recipient]) return wires[recipient]

    const wire = wires[recipient] = manager._createWire(recipient)
    wire.setMaxListeners(0)

    eos(wire, function () {
      delete wires[recipient]
      if (!destroyed && destroying && Object.keys(wires).length === 0) {
        destroyed = true
        manager.emit('destroy')
      }
    })

    wire.on('ack', function (ack) {
      const cbs = callbacks[recipient]
      const cb = cbs && cbs[ack]
      if (!cb) return

      delete cbs[ack]
      const args = cb._wsManagerArgs
      const idx = queues[recipient] ? queues[recipient].indexOf(args) : -1
      if (idx !== -1) queues[recipient].splice(idx, 1)

      cb()
    })

    WIRE_EVENTS.forEach(function (event) {
      wire.on(event, function (data) {
        if (destroying || destroyed) return

        manager.emit(event, data, recipient)
      })
    })

    const acks = ackCache[recipient]
    if (acks) {
      Object.keys(acks).sort(increasingNum).forEach(function (seq) {
        manager.ack(recipient, seq)
      })
    }

    return wire
  }

  manager._createWire = function (recipient) {
    // overwrite this
    throw new Error('overwrite this!')
  }

  manager.send = function (recipient, msg, cb) {
    const wire = manager.wire(recipient)
    const buf = toBuffer(msg)
    wire.send(buf)
    if (!callbacks[recipient]) callbacks[recipient] = {}

    const seq = Buffer.isBuffer(msg) ? utils.seq(buf) : msg.seq
    callbacks[recipient][seq] = cb
    if (!queues[recipient]) queues[recipient] = []

    cb._wsManagerArgs = arguments
    queues[recipient].push(arguments)
  }

  manager.destroy = function (cb) {
    if (destroyed) {
      if (cb) process.nextTick(cb)

      return
    }

    destroying = true
    if (cb) manager.once('destroy', cb)
  }

  manager.ack = function (recipient, msg) {
    const seq = msg.seq || msg
    if (typeof seq !== 'number') throw new Error('invalid seq')

    const wire = wires[recipient]
    if (wire) return wire.ack(seq)

    debug(`caching ack for msg ${seq} from ${recipient}`)
    if (!ackCache[recipient]) {
      ackCache[recipient] = {}
    }

    ackCache[recipient][seq] = true
  }

  return manager
}

function increasingNum (a, b) {
  return a - b
}

function toBuffer (obj) {
  if (
    obj instanceof Uint8Array ||
    obj instanceof ArrayBuffer ||
    typeof obj === 'string'
  ) {
    return new Buffer(obj)
  }

  if (Buffer.isBuffer(obj)) return obj

  return new Buffer(JSON.stringify(obj))
}
