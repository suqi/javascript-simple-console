var connect = require('connect')
var app = connect.createServer(
    connect.bodyParser(),
    connect.static(__dirname + '/public')
)
var t, start

app.use('/a', function(req,res){
    res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache'})
    t = res
    t.socket.setTimeout(5000,function(e){
        console.log('timeout', Date.now() - start)
    })
    start = Date.now()
    t.on('close',function(){
        console.log('close', Date.now() - start)
    })
})

app.listen(8080)
