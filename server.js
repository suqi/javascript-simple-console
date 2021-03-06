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
    NO_DEBUG_PAGE = 'event: rest\ndata: No debug page found\n\n',
    DEBUG_PAGE_READY= 'event: ready\ndata: Debug page is ready,try coding now\n\n',
    BE_KICKED = 'event: kicked\ndata: you are kicked by somebody.\n\n',
    CONNECTION_TIMEOUT = 5*1000 //长连接超时间隔,五秒没有消息发送到客户端则关闭连接

var msgManager = {}, //存储所有监听用户的最新一条的运行代码以及对应的执行结果
    responseQueue = [], //存储所有的调试页面的长连接
    consoleQueue = [],  //存储所有控制台页面的长连接
    lockedMsg = {} //存储所有的锁定代码,新请求进入时自动执行一次此代码

//向控制台发送通知消息,第一个调试页面打开和最后一个调试页面关闭
var notifySpecConsole = function(username,msg){
    if(!responseQueue.some(function(client){return client.details.username == username})){
        for(var i =0;i<consoleQueue.length;i++){
            if(consoleQueue[i].details.username == username){
                consoleQueue[i].write(msg)
                break
            }
        }
    }
}

//控制连接数,剔除最早进入的用户
var checkConnections = function(){
    consoleQueue.length > MAX_CONSOLE_NUM && consoleQueue.splice(0,consoleQueue.length - MAX_CONSOLE_NUM).forEach(function(res){
        res.write(MAX_INFO)
    })
    responseQueue.length > MAX_DEBUG_NUM && responseQueue.splice(0,responseQueue.length - MAX_DEBUG_NUM).forEach(function(res){
        res.write(MAX_INFO)
    })
}

//index.html 发送运行代码, 格式 : /input?simongfxu=console.log(123)
app.use('/input', function(req,res){
    res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-cache'})
	try{
		var username = req.body.username, content = decodeURIComponent(req.body.content)
		msgManager[username] = { content : content, time : Date.now() }
		res.end(JSON.stringify({ret:0, msg:msgManager[username], username:username, openDebug : responseQueue.some(function(item){ return item.details.username == username})}))
	}catch(e){
		res.end(JSON.stringify({ret:1, msg:e.message}))
	}
})

//comm.html 发送远程执行结果, 格式: request format : /output?simongfxu=undefined
app.use('/output', function(req, res){
    res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-cache'})
    try{
        var username = req.body.username, result = req.body.result
        msgManager[username].result = result
        res.end(JSON.stringify({ret:0,result:result, username:username}))
    }catch(e){
        res.end(JSON.stringify({ret:1,msg:e.message}))
    }
})


//index.html 锁定代码,此用户的新请求将自动执行一次此代码,并返回执行结果给控制台
app.use('/lock', function(req,res){
    res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-cache'})
    try{
        var username = req.body.username, content = decodeURIComponent(req.body.content)
        lockedMsg[username] = content
        res.end(JSON.stringify({ret:0, content:content, username:username}))
    }catch(e){
        res.end(JSON.stringify({ret:1,msg:e.message}))
    }
})

//index.html 解锁代码
app.use('/unlock', function(req,res){
    res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-cache'})
    try{
        delete lockedMsg[req.body.username]
        res.end(JSON.stringify({ret:0, username:req.body.username}))
    }catch (e){
        res.end(JSON.stringify({ret:1,msg:e.message}))
    }
})

//comm.html 用于获取执行脚本的长连接,获取后页面使用postMessage发送到调试页面执行
app.use('/send_polling', function(req, res){
    var username = req.url.indexOf('?')>-1 && req.url.split('?')[1]
	if(username){
        //这一步很重要,EventSource调用close以后服务器可能不会马上响应close事件而是走超时的逻辑,所以将超时设置为一个较小的值让服务器尽快关闭长连接释放资源
        res.socket.setTimeout(CONNECTION_TIMEOUT)
        res.socket.on('close',function(e){
            var id = res.details.username
            //从连接队列中移除长连接
            responseQueue.indexOf(res) !=-1 && responseQueue.splice(responseQueue.indexOf(res), 1)
            notifySpecConsole(id, NO_DEBUG_PAGE)
            console.log('debug connection closed from : ', id, '    ' ,responseQueue.length, ' connection current')
        })
        res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'})
		res.details = {username:username, requestOn:Date.now(), userAgent:req.headers['user-agent'], ip : req.headers['x-forwarded-for'] || req.connection.remoteAddress}
        notifySpecConsole(username, DEBUG_PAGE_READY)
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
            consoleQueue.indexOf(res) != -1 && consoleQueue.splice(consoleQueue.indexOf(res), 1)
            console.log('console connection closed from : ', res.details.username, '    ', consoleQueue.length,' connection total')
        })
        //每个用户只能打开一个控制台页面
        consoleQueue = consoleQueue.filter(function(item){
            if(item.details.username == username){
                item.write(BE_KICKED)
                return false
            }
            return true
        })
        res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'})
        res.details = {username:username, requestOn: Date.now(), ip : req.headers['x-forwarded-for'] || req.connection.remoteAddress}
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
        res.end(JSON.stringify(ret))
    }catch (e){
        res.end(JSON.stringify({ret:-1, msg:e.message}))
    }
})

app.use(function(req,res){
    res.end('Page Not found')
})

app.listen(PORT)

console.log('Server is running on port ', PORT)

 //维持长连接必须不断地向页面发送数据，如果长时间不发送数据，服务端会以超时处理关闭该请求。
;~function(){
    checkConnections()
    //分别向控制台页面和调试页面发送执行结果和运行代码
    responseQueue.forEach(function(client){
        var info = msgManager[client.details.username]
        //调试页面使用XHR兼容了安卓，encode需要运行的代码，主要是处理\n\n
        info && info.content ? client.write('data: ' + encodeURIComponent(info.content) + '\n\n'):client.write(': \n\n')
    })
    consoleQueue.forEach(function(res){
        var info = msgManager[res.details.username]
        info && info.result ? res.write('data: ' + info.result + '\n\n'):res.write(': \n\n')
    })
    for(var key in msgManager){
        delete msgManager[key].content
        delete msgManager[key].result
    }
    setTimeout(arguments.callee, PERIOD)
}()