// catalog js
// 目录固定在右栏(sticky),这里只负责高亮当前标题和移动端开合
var catalog = document.getElementById('catalog')
var tocElement = document.querySelector('.catalog-content')

if (catalog && tocElement) {
  var headerLinkList = document.getElementsByClassName('headerlink')
  var catLinkList = document.getElementsByClassName('toc-link')

  // 是否激活目录
  function isActiveCat() {
    // 可宽限高度值
    var offsetHeight = 20

    // 当前页面滚动位置距页面顶部的高度值
    var scrollTop = document.documentElement.scrollTop || document.body.scrollTop

    if (!headerLinkList.length) return

    for (var i = 0; i < catLinkList.length; i++) {
      var currentTopCat = headerLinkList[i].offsetTop - offsetHeight
      var nextTopCat = i + 1 === headerLinkList.length
        ? Infinity
        : headerLinkList[i + 1].offsetTop - offsetHeight

      if (scrollTop >= currentTopCat && scrollTop < nextTopCat) {
        catLinkList[i].className = 'toc-link active'
        tocElement.scrollTop = catLinkList[i].offsetTop - 32
      } else {
        catLinkList[i].className = 'toc-link'
      }
    }
  }

  var btnCatalog = document.getElementById('btn-catalog')
  if (btnCatalog) {
    btnCatalog.addEventListener('click', function () {
      catalog.classList.toggle('hidden')
    }, false)
  }

  document.addEventListener('scroll', isActiveCat, false)
  isActiveCat()
}
