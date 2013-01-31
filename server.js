var connect = require('connect')
var app = connect.createServer(
    connect.bodyParser(),
	connect.static(__dirname + '/public'),
    connect.static(__dirname + '/tests')
)

var PORT = 10102, //监听端口
    PERIOD = 300, //服务端任务执行周期
    MAX_CONSOLE_NUM = 100, //控制台长连接上限
    MAX_DEBUG_NUM = MAX_CONSOLE_NUM * 5, //调试页面长连接上限
    MAX_INFO = 'event: max\ndata: too many connections\n\n',
    NO_DEBUG_PAGE = 'event: rest\nNo debug page found\n\n',
    BE_KICKED = 'event: kicked\ndata: you are kicked by somebody.\n\n',
    CONNECTION_TIMEOUT = 5*1000 //长连接超时间隔,五秒没有消息发送到客户端则关闭连接

var msgManager = {}, //存储所有监听用户的最新一条的运行代码以及对应的执行结果
    responseQueue = [], //存储所有的调试页面的长连接
    consoleQueue = [],  //存储所有控制台页面的长连接
    lockedMsg = {} //存储所有的锁定代码,新请求进入时自动执行一次此代码

//index.html 发送运行代码, 格式 : /input?simongfxu=console.log(123)
app.use('/input', function(req,res){
    res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-cache'})
	try{
		var username = decodeURIComponent(req.body.username), content = decodeURIComponent(req.body.content)
		msgManager[username] = { content : content, time : Date.now() }
        console.log('get message from console : ', content, ' by ', username)
		res.write(JSON.stringify({ret:0, msg:msgManager[username], username:username, openDebug : responseQueue.some(function(item){ return item.details.username == username})}))
	}catch(e){
		res.write(JSON.stringify({ret:-2,msg:e.message}))
	}
	res.end()
})

//comm.html 发送远程执行结果, 格式: request format : /output?simongfxu=undefined
app.use('/output', function(req, res){
    res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-cache'})
    try{
        var username = decodeURIComponent(req.body.username), result = req.body.result
        msgManager[username].result = result
        console.log('remote execute result : ', result, ' by ', username)
        res.write(JSON.stringify({ret:0,result:result, username:username}))
    }catch(e){
        res.write(JSON.stringify({ret:-1,msg:e.message}))
    }
    res.end()
})


//index.html 锁定代码,此用户的新请求将自动执行一次此代码,并返回执行结果给控制台
app.use('/lock', function(req,res){
    res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-cache'})
    try{
        var username = req.body.username, content = decodeURIComponent(req.body.content)
        lockedMsg[username] = content
        res.write(JSON.stringify({ret:0, content:content, username:username}))
    }catch(e){
        res.write(JSON.stringify({ret:-1,msg:e.message}))
    }
    res.end()
})

//index.html 解锁代码
app.use('/unlock', function(req,res){
    res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-cache'})
    try{
        delete lockedMsg[req.body.username]
        res.write(JSON.stringify({ret:0, username:req.body.username}))
    }catch (e){
        res.write(JSON.stringify({ret:-1,msg:e.message}))
    }
    res.end()
})

//comm.html 用于获取执行脚本的长连接,获取后页面使用postMessage发送到调试页面执行
app.use('/send_polling', function(req, res){
    var username = req.url.indexOf('?')>-1 && decodeURIComponent(req.url.split('?')[1])
	if(username){
        //这一步很重要,EventSource调用close以后服务器可能不会马上响应close事件而是走超时的逻辑,所以将超时设置为一个较小的值让服务器尽快关闭长连接释放资源
        res.socket.setTimeout(CONNECTION_TIMEOUT)
        res.socket.on('close',function(e){
            //从连接队列中移除长连接,如果这是最后一个调试页面则提示控制台页面
            responseQueue.indexOf(res)>-1 && (responseQueue = responseQueue.filter(function(client){return client != res}))
            var username = res.details.username
            if(!responseQueue.some(function(client){return client.details.username == username})){
                consoleQueue.filter(function(client){
                    return client.details.username == username
                }).forEach(function(client){
                        client.write(NO_DEBUG_PAGE)
                })
            }
            console.log('debug connection closed from : ', username, '    ' ,responseQueue.length, ' connection current')
        })
        //must match : EventSource's response has a MIME type ("text/plain") that is not "text/event-stream". Aborting the connection.
        res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'})
		res.details = {username:username, requestOn:Date.now(), userAgent:req.headers['user-agent'], ip : req.connection.remoteAddress}

        //如果这是第一个调试页面也通知控制台页面
        if(!responseQueue.some(function(res){return res.details.username == username})){
            consoleQueue.filter(function(client){
                return client.details.username == username
            }).forEach(function(client){
                client.write('event: ready\ndata: Debug page is ready,try coding now\n\n')
            })
        }
        lockedMsg[username] && res.write('data: ' + encodeURIComponent(lockedMsg[username]) + '\n\n')
		responseQueue.push(res)
		console.log('debug connection created for : ', username, '    ', responseQueue.length,' connection total')
	}else{
        res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'close'})
    }
})

 //index.html 用于获取代码执行结果的长连接
app.use('/rev_polling', function(req, res){
    var username =  req.url.indexOf('?')>-1 && req.url.split('?')[1]
    if(username){
        res.socket.setTimeout(CONNECTION_TIMEOUT)
        res.socket.on('close',function(){
            consoleQueue.indexOf(res)>-1 && (consoleQueue = consoleQueue.filter(function(client){return client != res}))
            console.log('console connection closed from : ', res.details.username, '    ', consoleQueue.length,' connection total')
        })
        //每个用户只能打开一个控制台页面
        consoleQueue = consoleQueue.filter(function(item){
            if(item.details.username == username){
                console.log('console connection was kicked out : ', username)
                item.write(BE_KICKED)
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

//监控页面，获取当前所有的长连接以及相关信息
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

 //维持长连接必须不断地向页面发送数据，如果长时间不发送数据，服务端会以超时处理关闭该请求。
;~function(){
    //连接数控制
    consoleQueue.length > MAX_CONSOLE_NUM && consoleQueue.splice(0,consoleQueue.length - MAX_CONSOLE_NUM).forEach(function(res){
        res.write(MAX_INFO)
    })
    responseQueue.length > MAX_DEBUG_NUM && responseQueue.splice(0,responseQueue.length - MAX_DEBUG_NUM).forEach(function(res){
        res.write(MAX_INFO)
    })

    //分别向控制台页面和调试页面发送执行结果和运行代码
    responseQueue.forEach(function(client){
        var userInfo = msgManager[client.details.username]
        //调试页面使用XHR兼容了安卓，需要encode需要运行的代码，否则comm.html无法分析数据（主要是处理\n\n）
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
    setTimeout(arguments.callee, PERIOD)
}()