/**
 * DESIGN LIMITATION
 * For every user, one console page can control multi debug pages.
 * But if you open another console page for the same user, the previous console page will be closed.
 * Just because msgManager only stores one script content and remote executed result for one user.
 * You'd better just send comment and real message in responseQueue, because Android does not support EventSource
 */
var connect = require('connect')
var app = connect.createServer(
    connect.bodyParser(),
	connect.static(__dirname + '/public')
)

var PORT = 10102, PERIOD = 300, MAX_CONSOLE_NUM = 200, MAX_DEBUG_NUM = MAX_CONSOLE_NUM * 5, MAX_INFO = 'event: max\ndata: too many connections\n\n'

var msgManager = {},responseQueue = [],consoleQueue = []

/**
 * send debug script content to server. request format : /input?simongfxu=console.log(123)
**/
app.use('/input', function(req,res){
    res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-cache'})
	try{
		var info = req.url.split('?'), username = decodeURIComponent(info[1]), msg = decodeURIComponent(req.body.content)
		msgManager[username] = { content : msg, time : Date.now() }
        console.log('get message from console : ', msg, ' by ', username)
		res.write(JSON.stringify({ret:0, msg:msgManager[username], username:username}))
	}catch(e){
		res.write(JSON.stringify({ret:-2,msg:e.message}))
	}
	res.end()
})

/**
 * send executed result of the debug script to server. request format : /output?simongfxu=undefined
 */
app.use('/output', function(req, res){
    res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-cache'})
    try{
        var info = req.url.split('?'), username = decodeURIComponent(info[1]), result = req.body.result
        msgManager[username].result = result
        console.log('remote execute result : ', result, ' by ', username)
        res.write(JSON.stringify({ret:0,result:result, username:username}))
    }catch(e){
        res.write(JSON.stringify({ret:-1,msg:e.message}))
    }
    res.end()
})

/**
 * an event stream for mobile page to get the debug script from server push, using postMessage to cross domain in comm.html
**/
app.use('/send_polling', function(req, res){
    var username = req.url.indexOf('?')>-1 && decodeURIComponent(req.url.split('?')[1])
	if(username){
        req.on('close',function(e){
            responseQueue.indexOf(res)>-1 && (responseQueue = responseQueue.filter(function(client){return client != res}))
            //notify the console page when the last debug page is closed
            var username = res.details.username
            if(!responseQueue.some(function(client){return client.details.username == username})){
                consoleQueue.filter(function(client){
                    return client.details.username == username
                }).forEach(function(client){
                        client.write('data: No debug page found\n\n')
                    })
            }
            console.log('debug connection closed from : ', username, '    ' ,responseQueue.length, ' connection current')
        })
        //must match : EventSource's response has a MIME type ("text/plain") that is not "text/event-stream". Aborting the connection.
        res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'})
		res.details = {username:username, requestOn:Date.now(), userAgent:req.headers['user-agent'], ip : req.connection.remoteAddress}
        //notify the console page when the first debug page is ready
        if(!responseQueue.some(function(res){return res.details.username == username})){
            consoleQueue.filter(function(client){
                return client.details.username == username
            }).forEach(function(client){
                client.write('data: Debug page is ready,try coding now\n\n')
            })
        }
		responseQueue.push(res)
		console.log('debug connection created for : ', username, '    ', responseQueue.length,' connection total')
	}else{
        res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'close'})
    }
})

/**
 * an event stream for console page to get the remote executed result.
 */
app.use('/rev_polling', function(req, res){
    var username =  req.url.indexOf('?')>-1 && req.url.split('?')[1]
    if(username){
        req.on('close',function(){
            consoleQueue.indexOf(res)>-1 && (consoleQueue = consoleQueue.filter(function(client){return client != res}))
            console.log('console connection closed from : ', res.details.username, '    ', consoleQueue.length,' connection total')
        })
        //only accepts the latest console, kick out the previous console pages
        consoleQueue = consoleQueue.filter(function(item){
            if(item.details.username == username){
                console.log('console connection was kicked out : ', username)
                item.write('event: kicked\ndata: you are kicked by somebody.\n\n')
                return false
            }
            return true
        })
        res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'})
        res.details = {username:username, requestOn: Date.now(), ip : req.connection.remoteAddress}
        consoleQueue.push(res)
        console.log('console connection created for : ', username, '    ', consoleQueue.length, ' connection total')
    }else{
        res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'close'})
    }
})

/**
 * manage all the console pages and debug pages
 */
app.use('/manage', function(req, res){
    res.writeHead(200,{'Content-type':'text/plain','Cache-Control':'no-cache','Connection':'keep-alive'})
    try{
        var ret = {ret:0, console:[], client:[], message : msgManager, period : PERIOD, port : PORT}
        consoleQueue.forEach(function(client){
            ret.console.push({'username':client.details.username, 'ip':client.details.ip})
        })
        responseQueue.forEach(function(client){
            ret.client.push({'username':client.details.username, 'userAgent' : client.details.userAgent,'ip':client.details.ip})
        })
        res.write(JSON.stringify(ret))
    }catch (e){
        console.log(e)
        res.write(JSON.stringify({ret:-1, msg:e.message}))
    }
    res.end()
})

app.use(function(req,res){
    res.end('Page Not found')
})

app.listen(PORT)

console.log('Server is running on port ', PORT)

/**
 * CAUTION
 * 1.avoid sending too much info in the timer.
 * 2.send comment to keep the connection alive, other else the request close event will not trigger immediately
 */
;~function(){
    //connection number control
    consoleQueue.length > MAX_CONSOLE_NUM && consoleQueue.splice(0,consoleQueue.length - MAX_CONSOLE_NUM).forEach(function(res){
        res.write(MAX_INFO)
    })
    responseQueue.length > MAX_DEBUG_NUM && responseQueue.splice(0,responseQueue.length - MAX_DEBUG_NUM).forEach(function(res){
        res.write(MAX_INFO)
    })

    responseQueue.forEach(function(client){
        var userInfo = msgManager[client.details.username]
        //debug page maybe android,encode script content's \n\n for XHR,EventSource has no need to encode
        userInfo && userInfo.content ? client.write('data: ' + encodeURIComponent(userInfo.content) + '\n\n'):client.write(': \n\n')
    })
    consoleQueue.forEach(function(res){
        var userInfo = msgManager[res.details.username]
        userInfo && userInfo.result ? res.write('data: ' + userInfo.result + '\n\n'):res.write(': \n\n')
    })
    for(var key in msgManager){
        msgManager[key].content = ''
        msgManager[key].result = ''
    }
    var self = arguments.callee
    setTimeout(self, PERIOD)
}()