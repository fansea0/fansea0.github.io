// 代码块折叠:行数达到 minLines 的代码块,标题栏出现折叠按钮
window.addEventListener('DOMContentLoaded', function () {
  var cfg = window.__codeCollapse || {}
  var minLines = cfg.minLines > 0 ? cfg.minLines : 12
  var defaultCollapsed = !!cfg.defaultCollapsed

  document.querySelectorAll('.markdown-body figure.highlight').forEach(function (figure) {
    var codeCell = figure.querySelector('.code')
    if (!codeCell) return
    var lineCount = codeCell.querySelectorAll('span.line').length
    if (lineCount < minLines) return

    // 折叠后表格整块隐藏,标题栏是唯一的展开入口,所以一定要有
    var caption = figure.querySelector('figcaption')
    if (!caption) {
      caption = document.createElement('figcaption')
      caption.className = 'code-collapse-bar'
      var lang = 'Text'
      figure.classList.forEach(function (c) {
        if (c !== 'highlight' && c !== 'code') lang = c
      })
      var label = document.createElement('span')
      label.textContent = lang
      caption.appendChild(label)
      figure.insertBefore(caption, figure.firstChild)
    }

    var hint = document.createElement('span')
    hint.className = 'code-collapse-hint'
    hint.textContent = '代码已折叠,共 ' + lineCount + ' 行'

    var btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'code-collapse-toggle'
    btn.setAttribute('aria-label', '折叠或展开代码块')
    btn.setAttribute('aria-expanded', 'true')

    caption.appendChild(hint)
    caption.appendChild(btn)

    function setOpen (open) {
      figure.classList.toggle('is-code-collapsed', !open)
      btn.setAttribute('aria-expanded', open ? 'true' : 'false')
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(figure.classList.contains('is-code-collapsed'))
    })

    if (defaultCollapsed) setOpen(false)
  })
})
