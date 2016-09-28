
var path = require('path')
var test = require('tape')
var WebSocketServer = require('../server')
var WSClient = require('../client')
var strings = require('./fixtures/strings')
var BASE_PORT = 22222

;[true, false].forEach(function (goodConnection) {
  test(goodConnection ? 'good connection' : 'bad connection', function (t) {
    t.timeoutAfter(90000)
    var port = BASE_PORT++

    var wsPath = '/custom/relay/path'
    var ted = new WebSocketServer({
      port: port,
      path: wsPath
    })

    var serverURL = 'http://127.0.0.1:' + port + path.join('/', wsPath)
    var bill = new WSClient({
      wireOpts: { plaintext: true },
      url: serverURL + '?from=bill'
    })

    var toTed = toBuffer({
      dear: 'ted',
      contents: 'sixmeg'.repeat(1000000),
      seq: 1
    })

    bill.send('ted', toTed, function () {
      t.pass('delivery confirmed')
      finish()
    })

    var toBill = toBuffer({
      dear: 'bill',
      contents: 'sixmeg'.repeat(1000000),
      seq: 1
    })

    ted.send('bill', toBill, function () {
      t.pass('delivery confirmed')
      finish()
    })

    ted.on('message', function (actual, from) {
      t.same(actual, toTed, 'received')
      t.equal(from, 'bill')
      ted.ack(from, JSON.parse(actual).seq)
      finish()
    })

    bill.on('message', function (actual, from) {
      t.same(actual, toBill, 'received')
      t.equal(from, 'ted')
      ted.ack(from, JSON.parse(actual).seq)
      finish()
    })

    if (!goodConnection) {
      setInterval(function () {
        // randomly drop connections
        bill._socket.end()
      }, 100).unref()
    }

    var togo = 4 // 2 people * (send + receive)

    function finish (err) {
      if (err) throw err
      if (--togo) return

      t.end()
      bill.destroy()
      ted.destroy()
    }
  })
})

function toBuffer (obj) {
  return new Buffer(JSON.stringify(obj))
}
