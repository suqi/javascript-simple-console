;~function(W,D){
    var scripts = D.querySelectorAll('script')
    var srcInfo = scripts[scripts.length-1].src
    var iframe = D.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = srcInfo.replace('remote.js','comm.html')
    D.body.appendChild(iframe)

	W.onmessage = function(e){
        var evalResult = ''
        try{
            evalResult = eval(e.data)
        }catch (e){
            evalResult = e.name + ' : ' + e.message
        }
	    iframe.contentWindow.postMessage(encodeURIComponent(evalResult),"*")
        console.log('script executed result : ', evalResult)
    }
}(window,document)