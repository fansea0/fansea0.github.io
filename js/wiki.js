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

  // ---- 目录树展开/收起 ----
  var tree = document.getElementById('wiki-tree')

  if (tree) {
    var state = loadState()

    tree.querySelectorAll('.wiki-node-folder').forEach(function (node) {
      node.classList.add('is-open')
      if (state[node.getAttribute('data-folder')] === 'collapsed') {
        node.classList.add('is-collapsed')
      }
    })

    tree.addEventListener('click', function (e) {
      // 点链接是跳转,不拦截
      if (e.target.closest('.wiki-node-link')) return

      var row = e.target.closest('.wiki-node-row')
      if (!row) return
      var node = row.closest('.wiki-node-folder')
      if (!node) return

      var collapsed = node.classList.toggle('is-collapsed')
      var key = node.getAttribute('data-folder')
      var next = loadState()
      if (collapsed) next[key] = 'collapsed'
      else delete next[key]
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
