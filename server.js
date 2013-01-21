/**
 * DESIGN LIMITATION
 * For every user, one console page can control multi debug pages.
 * But if you open another console page for the same user, the previous console page will be closed.
 * Just because msgManager only stores one script content and remote executed result for one user.
 */
var connect = require('connect')
var app = connect.createServer(
    connect.bodyParser(),
	connect.static(__dirname + '/public')
)
var PORT = 10102, PERIOD = 500, msgManager = {},responseQueue = [],consoleQueue = []

app.listen(PORT)

console.log('Server is running on port ', PORT)

/**
 * send debug script content to server. request format : /input?simongfxu=console.log(123)
**/
app.use('/input', function(req,res){
    res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-cache'})
    var referer = req.headers['referer']
    if(!referer || referer.split('?').length<2){
        res.write(JSON.stringify({ret:-1}))
        res.end()
        return
    }
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
	res.on('close',function(e){
        responseQueue.indexOf(res)>-1 && (responseQueue = responseQueue.filter(function(client){return client != res}))
        console.log('debug connection closed from : ', res.details.username, '    ' ,responseQueue.length, ' connection current')
	})
	var username = decodeURIComponent(req.url.split('?')[1])
    //must match : EventSource's response has a MIME type ("text/plain") that is not "text/event-stream". Aborting the connection.
    res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'})
	if(username){
		res.details = {username:username, requestOn:Date.now(), userAgent:req.headers['user-agent'], ip : req.connection.remoteAddress}
		responseQueue.push(res)
		console.log('debug connection created for : ', username, '    ', responseQueue.length,' connection total')
	}else{
        res.write('data: username not found\n\n')
        res.close()
	}
})

/**
 * an event stream for console page to get the remote executed result.
 */
app.use('/rev_polling', function(req, res){
    res.on('close',function(e){
        consoleQueue.indexOf(res)>-1 && (consoleQueue = consoleQueue.filter(function(client){return client != res}))
        console.log('console connection close : ', res.details.username, '    ', consoleQueue.length,' connection total')
    })
    var username =  decodeURIComponent(req.url.split('?')[1])
    //only accepts the latest console
    consoleQueue = consoleQueue.filter(function(item){
        if(item.details.username == username){
            console.log('console connection closed : ', username)
            item.write('data: CLOSE\n\n')
            return false
        }
        return true
    })
    res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'})
    if(username){
        res.details = {username:username, requestOn: Date.now(), ip : req.connection.remoteAddress}
        consoleQueue.push(res)
        console.log('console connection created for : ', username, '    ', consoleQueue.length, ' connection total')
    }else{
        res.write('data: username not found\n\n')
        res.close()
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

var timer = setInterval(function(){
    responseQueue.forEach(function(client){
        var userInfo = msgManager[client.details.username]
        msg = userInfo && userInfo.content && client.write('data: ' + userInfo.content + '\n\n')
    })
    consoleQueue.forEach(function(res){
        var debugPageOpened = responseQueue.filter(function(client){return client.details.username == res.details.username}).length > 0
        if(debugPageOpened){
            var userInfo = msgManager[res.details.username]
            userInfo && userInfo.result && res.write('data: ' + userInfo.result + '\n\n')
        }else{
            res.write('data: No debug page found\n\n')
        }
    })
    for(var key in msgManager){
        msgManager[key].content = ''
        msgManager[key].result = ''
    }
}, PERIOD)