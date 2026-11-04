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
  var closeBtn = document.getElementById('btn-catalog-close')
  var backdrop = document.getElementById('catalog-backdrop')

  function setOpen (open) {
    catalog.classList.toggle('hidden', !open)
    if (backdrop) backdrop.classList.toggle('is-open', open)
    if (btnCatalog) btnCatalog.setAttribute('aria-expanded', open ? 'true' : 'false')
  }

  if (btnCatalog) {
    btnCatalog.addEventListener('click', function () {
      setOpen(catalog.classList.contains('hidden'))
    }, false)
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', function () { setOpen(false) }, false)
  }
  if (backdrop) {
    backdrop.addEventListener('click', function () { setOpen(false) }, false)
  }
  // 移动端选完标题就收起,不然正文被挡住
  tocElement.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false)
  }, false)

  document.addEventListener('scroll', isActiveCat, false)
  isActiveCat()
}
