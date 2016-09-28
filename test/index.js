
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
      t.pass('bill->ted delivery confirmed')
      finish()
    })

    var toBill = toBuffer({
      dear: 'bill',
      contents: 'sixmeg'.repeat(1000000),
      seq: 1
    })

    ted.send('bill', toBill, function () {
      t.pass('ted->bill delivery confirmed')
      finish()
    })

    ted.once('message', function (actual, from) {
      t.same(actual, toTed, 'ted received')
      t.equal(from, 'bill')
      finish()
    })

    ted.on('message', function (actual, from) {
      ted.ack(from, JSON.parse(actual).seq)
    })

    bill.once('message', function (actual, from) {
      t.same(actual, toBill, 'bill received')
      t.equal(from, 'ted')
      finish()
    })

    bill.on('message', function (actual, from) {
      bill.ack(from, JSON.parse(actual).seq)
    })

    var togo = 4 // 2 people * (send + receive)

    function finish (err) {
      if (err) throw err
      if (--togo) {
        // kill bill
        if (!goodConnection) {
          console.log('killing bill')
          bill._socket.end()
        }

        return
      }

      t.end()
      bill.destroy()
      ted.destroy()
    }
  })
})

function toBuffer (obj) {
  return new Buffer(JSON.stringify(obj))
}
