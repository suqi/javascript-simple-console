var connect = require('connect')
var app = connect.createServer(
	//connect.bodyParser(),
	//connect.logger(),
	connect.static(__dirname + '/public')
)
//监听端口
var PORT = 10102
//Server轮训间隔
var PERIOD = 300
//消息管理器,存储执行的脚本,执行结果以及请求时间
var msgManager = {}
//存储所有的长连接Response
var responseQueue = []
//存储所有的控制台页面Response
var consoleQueue = []

app.listen(PORT)

/**
  保存输入的调试脚本
  格式:/input?simongfxu=console.log(123)
**/
app.use('/input', function(req,res){
	res.setHeader('Content-Type','text/plain')
	res.setHeader('Cache-Control','no-cache')
	try{
		var info = req.url.split('?')[1].split('='), username = info[0], msg = decodeURIComponent(info[1])
		msgManager[username] = { content : msg, time : Date.now()}
        console.log('username : ', username)
        console.log('receive message : ', msg)
		res.write('ok')
	}catch(e){
		res.write('fail')
	}
	res.end()
})

/**
 * 保存远程执行结果
 * 格式:/output?simongfxu=undefined
 */
app.use('/output', function(req, res){
    res.setHeader('Content-Type','text/plain')
    res.setHeader('Cache-Control','no-cache')
    try{
        var info = req.url.split('?')[1].split('='), username = info[0], result = decodeURIComponent(info[1])
        msgManager[username].result = result
        console.log('eval result : ', username, ' ',result)
        res.write('ok')
    }catch(e){
        res.write('fail')
    }
    res.end()
})

/**
  由移动设备页面引入remote.js的comm.html发起长连接请求,获取server push的脚本消息
**/
app.use('/send_polling', function(req, res){
	res.on('close',function(e){
        responseQueue.indexOf(res)>-1 && (responseQueue = responseQueue.filter(function(client){return client != res}))
        console.log('connection closed from : ', res.username)
        console.log('current client number : ', responseQueue.length)
	})
	var username = req.url.split('?')[1]
    //must match : EventSource's response has a MIME type ("text/plain") that is not "text/event-stream". Aborting the connection.
	res.setHeader('Content-Type','text/event-stream')
	res.setHeader('Cache-Control','no-cache')
	res.setHeader('Connection','keep-alive')
	if(username && responseQueue.indexOf(res) == -1){
		res.username = username
        res.UA = req.headers['user-agent']
		responseQueue.push(res)
		console.log('handling request from : ', username)
        console.log('total client number : ', responseQueue.length)
	}else{
		res.write('没有指定唯一的用户名')
		res.end()
	}
})

/**
 * 由控制台页面index.html发起长连接请求,获取server push的脚本执行结果
 */
app.use('/rev_polling', function(req, res){
    res.on('close',function(e){
        consoleQueue.indexOf(res)>-1 && (consoleQueue = consoleQueue.filter(function(client){return client != res}))
        console.log('console connection closed from : ', res.username)
        console.log('current console number : ', consoleQueue.length)
    })
    var username = req.url.split('?')[1]
    res.setHeader('Content-Type','text/event-stream')
    res.setHeader('Cache-Control','no-cache')
    res.setHeader('Connection','keep-alive')
    if(username && consoleQueue.indexOf(res) == -1){
        res.username = username
        consoleQueue.push(res)
        console.log('total console number : ', consoleQueue.length)
    }else{
        res.write('没有指定监听对象')
        res.end()
    }
})

/**
 * 后台监控页面,获取控制台页面和测试页面相关信息
 */
app.use('/manage', function(req, res){
    res.writeHead(200,{'Content-type':'text/plain','Cache-Control':'no-cache','Connection':'keep-alive'})
    var ret = {ret:0, console:[], client:[], message : msgManager, period : PERIOD, port : PORT}
    consoleQueue.forEach(function(client){
        ret.console.push({'username':client.username})
    })
    responseQueue.forEach(function(client){
        ret.client.push({'username':client.username, 'UA' : client.UA})
    })
    try{
        res.write(JSON.stringify(ret))
    }catch (e){
        console.log(e)
        res.write({ret:-1, message:e.message})
    }
    res.end()
})

var timer = setInterval(function(){
    responseQueue.forEach(function(client){
        var userInfo = msgManager[client.username], msg = userInfo && userInfo.content?('data: ' + userInfo.content):': '
        client.write(msg + '\n\n')
    })
    consoleQueue.forEach(function(res){
        var userInfo = msgManager[res.username], result = userInfo && userInfo.result?('data: ' + userInfo.result):': '
        res.write(result + '\n\n')
    })
    //消息发送完毕以后清空消息,不能在循环里清空,否则有的页面收不到消息
    for(var key in msgManager){
        msgManager[key].content = ''
        msgManager[key].result = ''
    }
}, PERIOD)
