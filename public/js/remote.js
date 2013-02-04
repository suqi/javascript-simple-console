;~function(W,D){
    /**
     * development : jsconsole.qq.com/js/remote.js?simongfxu
     * production : jsconsole.qq.com/js/remote.js?production#wrapper
     */
    var scripts = D.querySelectorAll('script'), src = scripts[scripts.length-1].src, anchor = D.createElement('a'), username
    anchor.href = src

    var goDebug = function(username){
        console.log('start listening for ', username)
        var iframe = D.createElement('iframe')
        iframe.style.display = 'none'
        iframe.src = src.split('?')[0].replace('js/remote.js','comm.html') + '?' + username
        D.body.appendChild(iframe)
        D.title = 'JavaScript Simple Console Works!'

        //thanks to jsconsole.com
        function sortci(a, b) {
            return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
        }

        // custom because I want to be able to introspect native browser objects *and* functions
        function stringify(o, simple, visited) {
            var json = '', i, vi, type = '', parts = [], names = [], circular = false;
            visited = visited || [];

            try {
                type = ({}).toString.call(o);
            } catch (e) { // only happens when typeof is protected (...randomly)
                type = '[object Object]';
            }

            // check for circular references
            for (vi = 0; vi < visited.length; vi++) {
                if (o === visited[vi]) {
                    circular = true;
                    break;
                }
            }

            if (circular) {
                json = '[circular]';
            } else if (type == '[object String]') {
                json = '"' + o.replace(/"/g, '\\"') + '"';
            } else if (type == '[object Array]') {
                visited.push(o);

                json = '[';
                for (i = 0; i < o.length; i++) {
                    parts.push(stringify(o[i], simple, visited));
                }
                json += parts.join(', ') + ']';
                json;
            } else if (type == '[object Object]') {
                visited.push(o);

                json = '{';
                for (i in o) {
                    names.push(i);
                }
                names.sort(sortci);
                for (i = 0; i < names.length; i++) {
                    parts.push( stringify(names[i], undefined, visited) + ': ' + stringify(o[ names[i] ], simple, visited) );
                }
                json += parts.join(', ') + '}';
            } else if (type == '[object Number]') {
                json = o+'';
            } else if (type == '[object Boolean]') {
                json = o ? 'true' : 'false';
            } else if (type == '[object Function]') {
                json = o.toString();
            } else if (o === null) {
                json = 'null';
            } else if (o === undefined) {
                json = 'undefined';
            } else if (simple == undefined) {
                visited.push(o);

                json = type + '{\n';
                for (i in o) {
                    names.push(i);
                }
                names.sort(sortci);
                for (i = 0; i < names.length; i++) {
                    try {
                        parts.push(names[i] + ': ' + stringify(o[names[i]], true, visited)); // safety from max stack
                    } catch (e) {
                        if (e.name == 'NS_ERROR_NOT_IMPLEMENTED') {
                            // do nothing - not sure it's useful to show this error when the variable is protected
                            // parts.push(names[i] + ': NS_ERROR_NOT_IMPLEMENTED');
                        }
                    }
                }
                json += parts.join(',\n') + '\n}';
            } else {
                try {
                    json = o+''; // should look like an object
                } catch (e) {}
            }
            return json;
        }

        W.addEventListener('message', function(e){
            var evalResult
            try{
                evalResult = eval(e.data)
            }catch (e){
                evalResult = e
            }
            var msg = encodeURIComponent(stringify(evalResult))
            console.log('script executed result : ', evalResult, msg)
            iframe.contentWindow.postMessage(msg,"*")
        })
    }

    //监听用户,测试环境在页面自己输入,生产环境需要用户输入QQ号
    if(anchor.search == '?production'){
        var listenNode = anchor.hash?D.querySelector(anchor.hash):D, tStart, tEnd, hasEverMoved = false, bind = false, tapTime = 10*1000
        var listeners = {
            start : function(e){
                tStart = Date.now()
            },
            move : function(e){
                hasEverMoved = true
            },
            end : function(e){
                tEnd = Date.now()
                if( !hasEverMoved && (tEnd - tStart >= tapTime) && !bind){
                    var text = W.prompt('','') || '', username = text.indexOf(':listen ') == 0?text.replace(':listen ',''):''
                    username.length > 4 && goDebug(username)
                    bind = true
                }
                hasEverMoved = false
                tStart = null
                tEnd = null
            }
        }
        listenNode.addEventListener('touchstart', listeners.start)
        listenNode.addEventListener('touchmove', listeners.move)
        listenNode.addEventListener('touchend', listeners.end)
    }else{
        username = anchor.search.slice(1)
        username && goDebug(username)
    }
}(window,document)