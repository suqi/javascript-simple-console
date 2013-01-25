var username = location.search && encodeURIComponent(location.search.slice(1)), source
$(function(){
    if(!username){
        $('#wrapper').html('<p>请在url上附加监听的用户,形式:?你的RTX名称</p>')
        return
    }
    $('#debug').attr('href', 'debug.html?' + username)
    $('#rtx').text(username)

    /**
     * 提交控制台脚本
     */
    var runScript = function (){
        var script = editor.getValue()
        if(!script || !username){
            alert('执行脚本和监听用户都不能为空')
            return
        }
        if(source && source.readyState == source.OPEN){
            var xhr = new XMLHttpRequest(), form = new FormData()
            form.append('content', encodeURIComponent(script))
            xhr.timeout = 5000
            xhr.addEventListener('load', function(){
                var json = JSON.parse(this.responseText)
                if(json.ret == 0){
                    if(json.openDebug){
                        $('#output').val('脚本提交成功,等待远程调试页面执行结果返回...')
                    }else{
                        $('#output').val('你还没有打开任何调试页面.在移动设备上打开后,重新运行代码')
                    }
                }
            })
            xhr.addEventListener('timeout', function(e){
                alert('请求超时')
            })
            xhr.addEventListener('error', function(e){
                console.log('请求出错')
            })
            xhr.open('POST','./input?' + username, true)
            xhr.send(form)
        }else{
            alert('连接已经被关闭,点击确定刷新页面继续调试')
            location.reload()
        }
    }

    /**
     * CodeMirror语法高亮
     */
    var editor = CodeMirror.fromTextArea($("#text")[0], {
        mode: "javascript",
        lineNumbers: true,
        lineWrapping: true,
        onCursorActivity: function() {
            editor.setLineClass(hlLine, null, null);
            hlLine = editor.setLineClass(editor.getCursor().line, null, "activeline");
        },
        onKeyEvent : function(self,e){
            if(e.type == 'keydown'){
                if(e.ctrlKey && e.which == 13){
                    e.preventDefault()
                    runScript()
                }
            }
        }
    })
    var hlLine = editor.setLineClass(0, "activeline")

    var closeConnection = function(msg){
        //服务器的close事件不一定能正确响应
        source.close()
        source = null
        document.write(msg)
        document.title = '-__-你被T了'
    }

    /**
     * Server Push,接受远程执行结果
     */
    source = new EventSource('./rev_polling?' + username)
    source.addEventListener('message', function(e){
        console.log('接受远程数据:',e)
        $('#output').val(decodeURIComponent(e.data))
    })
    source.addEventListener('kicked',function(e){
        closeConnection('为了防止控制台过多干扰调试结果,同一时间段只允许使用一个控制台.刷新页面可以抢夺当前用户的控制权')
    })
    source.addEventListener('max', function(e){
        closeConnection('当前访问人数超出了服务器限制.刷新页面可继续使用')
    })
    setTimeout(function(){
        closeConnection('为了节约服务器资源,每个长连接最多持续5分钟.刷新页面后继续使用')
    }, 5*1000*60)

    $('#text').focus()
    $('#sub').on('click', runScript)
})