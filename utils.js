const through = require('through2')
const protobufs = require('sendy-protobufs').ws
const schema = protobufs.schema

exports.encoder = function encoder (recipient) {
  return through(function (data, enc, cb) {
    var packet = protobufs.encode(schema.Packet, {
      to: recipient,
      data: data
    })

    cb(null, packet)
  })
}

exports.decoder = function decoder () {
  return through(function (data, enc, cb) {
    var result = protobufs.decode(data)
    cb(null, result.data)
  })
}

// hack for now
exports.seq = function (buf) {
  try {
    return JSON.parse(buf).seq
  } catch (err) {
    return Number(/\"_n\":(\d+)/.exec(buf)[1])
  }
}
