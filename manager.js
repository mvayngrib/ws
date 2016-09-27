const EventEmitter = require('events').EventEmitter
const eos = require('end-of-stream')
const debug = require('debug')('tradle:ws:manager')
const noop = function () {}
const WIRE_EVENTS = ['request', 'message', 'handshake', 'ack', 'error']

exports = module.exports = createManager
exports.WIRE_EVENTS = WIRE_EVENTS

function createManager (opts) {
  opts = opts || {}

  const ackCache = {}
  var wires = {}
  var callbacks = {}
  var closing
  var closed

  const manager = new EventEmitter()
  manager._read = function () {}
  manager.reset = function () {
    // don't reset ackCache
    for (var recipient in wires) {
      wires[recipient].end()
    }

    callbacks = {}
    wires = {}
  }

  manager.hasWire = function (recipient) {
    return recipient in wires
  }

  manager.wire = function (recipient) {
    if (!wires[recipient]) wires[recipient] = manager._createWire(recipient)

    const wire = wires[recipient]
    eos(wire, function () {
      delete wires[recipient]
      if (!closed && closing && Object.keys(wires).length === 0) {
        closed = true
        manager.emit('close')
      }
    })

    wire.on('ack', function (ack) {
      const cbs = callbacks[recipient]
      const cb = cbs && cbs[ack]
      if (!cb) return

      delete cbs[ack]
      cb()
    })

    WIRE_EVENTS.forEach(function (event) {
      wire.on(event, function (data) {
        if (closing || closed) return

        manager.emit(event, data, recipient)
      })
    })

    const acks = ackCache[recipient]
    if (acks) {
      Object.keys(acks).sort(increasingNum).forEach(function (seq) {
        manager.ack(seq, recipient)
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
    wire.send(toBuffer(msg))
    if (!callbacks[recipient]) callbacks[recipient] = {}

    const seq = Buffer.isBuffer(msg) ? JSON.parse(msg).seq : msg.seq
    callbacks[recipient][seq] = cb
  }

  manager.close = function (cb) {
    if (closed) return process.nextTick(cb)

    closing = true
    manager.once('close', cb)
  }

  manager.ack = function (msg, recipient) {
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
  if (Buffer.isBuffer(obj)) return obj
  if (typeof obj === 'string') return new Buffer(obj)
  return new Buffer(JSON.stringify(obj))
}
