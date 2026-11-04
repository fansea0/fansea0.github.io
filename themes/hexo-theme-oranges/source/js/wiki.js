// 目录树交互:展开/收起(状态记忆)、移动端抽屉
(function () {
  var STORAGE_KEY = 'wiki-tree-state'

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
    } catch (e) {
      return {}
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (e) {
      // 隐私模式下写不进去,忽略
    }
  }

  // ---- 目录树展开/收起(默认收起,只展开当前文章所在的分支) ----
  var tree = document.getElementById('wiki-tree')

  if (tree) {
    var state = loadState()

    // 当前所在文件夹,以及当前这篇文章的各级父文件夹
    var activeKeys = {}
    tree.querySelectorAll('.wiki-node-folder.is-current').forEach(function (node) {
      activeKeys[node.getAttribute('data-folder')] = true
    })
    var currentDoc = tree.querySelector('.wiki-node-doc.is-current')
    for (var el = currentDoc; el; el = el.parentElement) {
      if (el.classList && el.classList.contains('wiki-node-folder')) {
        activeKeys[el.getAttribute('data-folder')] = true
      }
    }

    function isDefaultOpen (node) {
      return Object.prototype.hasOwnProperty.call(activeKeys, node.getAttribute('data-folder'))
    }

    function setOpen (node, open) {
      node.classList.toggle('is-open', open)
      node.classList.toggle('is-collapsed', !open)
      var toggle = node.querySelector(':scope > .wiki-node-row > .wiki-node-toggle')
      if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
    }

    tree.querySelectorAll('.wiki-node-folder').forEach(function (node) {
      var key = node.getAttribute('data-folder')
      setOpen(node, state[key] === 'expanded' || (isDefaultOpen(node) && state[key] !== 'collapsed'))
    })

    tree.addEventListener('click', function (e) {
      // 点链接是跳转,不拦截
      if (e.target.closest('.wiki-node-link')) return

      var row = e.target.closest('.wiki-node-row')
      if (!row) return
      var node = row.closest('.wiki-node-folder')
      if (!node) return

      var open = !node.classList.contains('is-open')
      setOpen(node, open)

      var key = node.getAttribute('data-folder')
      var next = loadState()
      if (open === isDefaultOpen(node)) {
        // 回到默认状态,不需要记住
        delete next[key]
      } else {
        next[key] = open ? 'expanded' : 'collapsed'
      }
      saveState(next)
    })
  }

  // ---- 移动端抽屉 ----
  var menuBtn = document.getElementById('wiki-menu-btn')
  var sidebar = document.getElementById('wiki-sidebar')
  var scrim = document.getElementById('wiki-scrim')

  if (menuBtn && sidebar && scrim) {
    menuBtn.addEventListener('click', function () {
      var open = sidebar.classList.toggle('is-open')
      scrim.classList.toggle('is-open', open)
    }, false)

    scrim.addEventListener('click', function () {
      sidebar.classList.remove('is-open')
      scrim.classList.remove('is-open')
    }, false)

    // 点完链接自动收起抽屉
    sidebar.addEventListener('click', function (e) {
      if (!e.target.closest('.wiki-node-link')) return
      sidebar.classList.remove('is-open')
      scrim.classList.remove('is-open')
    }, false)
  }
})()
