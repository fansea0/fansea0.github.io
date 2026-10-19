// colorscheme.js
// 图标切换交给 CSS(深浅色各一套 SVG),这里只负责切属性和记状态
var switchHandle = document.querySelector('#switch-color-scheme')
var html = document.documentElement

if (switchHandle) {
  switchHandle.addEventListener('click', function () {
    var attr = html.getAttribute('color-mode')
    var colorMode = attr === 'light' ? 'dark' : 'light'
    html.setAttribute('color-mode', colorMode)
    localStorage.setItem('color-mode', colorMode)
  }, false)
}
