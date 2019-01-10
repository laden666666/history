import warning from 'tiny-warning';
import invariant from 'tiny-invariant';

import { createLocation, locationsAreEqual } from './LocationUtils';
import {
  addLeadingSlash,
  stripLeadingSlash,
  stripTrailingSlash,
  hasBasename,
  stripBasename,
  createPath
} from './PathUtils';
import createTransitionManager from './createTransitionManager';
import {
  canUseDOM,
  getConfirmation,
  supportsGoWithoutReloadUsingHash
} from './DOMUtils';

const HashChangeEvent = 'hashchange';

// 一个hash类型，用于让用户挑选合适的hash展现形式，共三种：
// hashbang: !/开头
// slash: /开头
// noslash: 无/
const HashPathCoders = {
  hashbang: {
    encodePath: path =>
      path.charAt(0) === '!' ? path : '!/' + stripLeadingSlash(path),
    decodePath: path => (path.charAt(0) === '!' ? path.substr(1) : path)
  },
  noslash: {
    encodePath: stripLeadingSlash,
    decodePath: addLeadingSlash
  },
  slash: {
    encodePath: addLeadingSlash,
    decodePath: addLeadingSlash
  }
};

// 获取hashpath。
function getHashPath() {
  // We can't use window.location.hash here because it's not
  // consistent across browsers - Firefox will pre-decode it!
  const href = window.location.href;
  // 因为兼容性不使用window.location.hash，学到了
  const hashIndex = href.indexOf('#');
  return hashIndex === -1 ? '' : href.substring(hashIndex + 1);
}

function pushHashPath(path) {
  // getHashPath考虑了兼容性问题，这里为什么直接修改window.location.hash？
  window.location.hash = path;
}

// 替换path
function replaceHashPath(path) {
  const hashIndex = window.location.href.indexOf('#');
  // 将url拼接到path上面
  window.location.replace(
    window.location.href.slice(0, hashIndex >= 0 ? hashIndex : 0) + '#' + path
  );
}

// 创建hash路由
function createHashHistory(props = {}) {
  invariant(canUseDOM, 'Hash history needs a DOM');

  const globalHistory = window.history;
  // 火狐中使用go会导致全局刷新
  const canGoWithoutReload = supportsGoWithoutReloadUsingHash();

  // 默认使用slash，默认使用Domutils提供的getConfirmation做离开提示
  const { getUserConfirmation = getConfirmation, hashType = 'slash' } = props;
  // 如果配置了basename，格式化用户给定的basename（增加开头的/，去除结尾的/）。否则取空串
  const basename = props.basename
    ? stripTrailingSlash(addLeadingSlash(props.basename))
    : '';

  // 根据hashType用户配置的类型，确定对显示的方式。
  const { encodePath, decodePath } = HashPathCoders[hashType];

  function getDOMLocation() {
    let path = decodePath(getHashPath());

    warning(
      !basename || hasBasename(path, basename),
      'You are attempting to use a basename on a page whose URL path does not begin ' +
        'with the basename. Expected path "' +
        path +
        '" to begin with "' +
        basename +
        '".'
    );

    // 将basename拼到给定的path上面
    if (basename) path = stripBasename(path, basename);

    // 创建的location
    return createLocation(path);
  }

  // 创建转场的回调函数管理类
  const transitionManager = createTransitionManager();

  function setState(nextState) {
    Object.assign(history, nextState);
    history.length = globalHistory.length;
    transitionManager.notifyListeners(history.location, history.action);
  }

  let forceNextPop = false;
  // 用于判断是否忽略浏览器变动的事件。因为用户调用了push等方法。但是无法判断是否真的
  let ignorePath = null;
  function handleHashChange() {
    const path = getHashPath();
    const encodedPath = encodePath(path);
    
    
    // 他们什么时候会不相等？第一次进入吗？用户修改？
    if (path !== encodedPath) {
      // Ensure we always have a properly-encoded hash.
      replaceHashPath(encodedPath);
    } else {
      const location = getDOMLocation();
      const prevLocation = history.location;

      if (!forceNextPop && locationsAreEqual(prevLocation, location)) return; // A hashchange doesn't always == location change.

      if (ignorePath === createPath(location)) return; // Ignore this change; we already setState in push/replace.

      ignorePath = null;

      handlePop(location);
    }
  }

  function handlePop(location) {
    if (forceNextPop) {
      forceNextPop = false;
      setState();
    } else {
      const action = 'POP';

      transitionManager.confirmTransitionTo(
        location,
        action,
        getUserConfirmation,
        ok => {
          if (ok) {
            setState({ action, location });
          } else {
            revertPop(location);
          }
        }
      );
    }
  }

  function revertPop(fromLocation) {
    const toLocation = history.location;

    // TODO: We could probably make this more reliable by
    // keeping a list of paths we've seen in sessionStorage.
    // Instead, we just default to 0 for paths we don't know.

    let toIndex = allPaths.lastIndexOf(createPath(toLocation));

    if (toIndex === -1) toIndex = 0;

    let fromIndex = allPaths.lastIndexOf(createPath(fromLocation));

    if (fromIndex === -1) fromIndex = 0;

    const delta = toIndex - fromIndex;

    if (delta) {
      forceNextPop = true;
      go(delta);
    }
  }

  // Ensure the hash is encoded properly before doing anything else.
  const path = getHashPath();
  const encodedPath = encodePath(path);

  if (path !== encodedPath) replaceHashPath(encodedPath);

  const initialLocation = getDOMLocation();
  // 在闭包中缓存浏览记录
  let allPaths = [createPath(initialLocation)];

  // Public interface
  // 以下都是公有接口，可用从https://github.com/ReactTraining/history查看

  // 用一个loaction对象生成href，这个方法文档上没有（手动滑稽）
  function createHref(location) {
    return '#' + encodePath(basename + createPath(location));
  }

  // 模拟history的push；
  function push(path, state) {
    warning(
      state === undefined,
      'Hash history cannot push state; it is ignored'
    );

    const action = 'PUSH';
    const location = createLocation(
      path,
      undefined,
      undefined,
      history.location
    );

    transitionManager.confirmTransitionTo(
      location,
      action,
      getUserConfirmation,
      ok => {
        if (!ok) return;

        // 跳转成功
        const path = createPath(location);
        const encodedPath = encodePath(basename + path);

        // 确定跳转后的url是否和当前url一样
        const hashChanged = getHashPath() !== encodedPath;

        // 对于hash不能使用相同的url。。。仅webkit内核是在location.assign一个和当前url完全相同的页面的时候，会触发onhashchange
        if (hashChanged) {
          // We cannot tell if a hashchange was caused by a PUSH, so we'd
          // rather setState here and ignore the hashchange. The caveat here
          // is that other hash histories in the page will consider it a POP.
          // 将跳转的path放到ignorePath里面，用于onhashchange的回调去忽略这个改变。
          ignorePath = path;
          pushHashPath(encodedPath);

          // 如果已经跳转到过这个页面，将其找出
          const prevIndex = allPaths.lastIndexOf(createPath(history.location));
          const nextPaths = allPaths.slice(
            0,
            prevIndex === -1 ? 0 : prevIndex + 1
          );

          nextPaths.push(path);
          allPaths = nextPaths;

          setState({ action, location });
        } else {
          warning(
            false,
            'Hash history cannot PUSH the same path; a new entry will not be added to the history stack'
          );

          setState();
        }
      }
    );
  }

  function replace(path, state) {
    warning(
      state === undefined,
      'Hash history cannot replace state; it is ignored'
    );

    const action = 'REPLACE';
    const location = createLocation(
      path,
      undefined,
      undefined,
      history.location
    );

    transitionManager.confirmTransitionTo(
      location,
      action,
      getUserConfirmation,
      ok => {
        if (!ok) return;

        const path = createPath(location);
        const encodedPath = encodePath(basename + path);

        // 判断是否跳转到指定的url
        const hashChanged = getHashPath() !== encodedPath;

        if (hashChanged) {
          // We cannot tell if a hashchange was caused by a REPLACE, so we'd
          // rather setState here and ignore the hashchange. The caveat here
          // is that other hash histories in the page will consider it a POP.
          
          ignorePath = path;
          replaceHashPath(encodedPath);
        }

        const prevIndex = allPaths.indexOf(createPath(history.location));

        if (prevIndex !== -1) allPaths[prevIndex] = path;

        setState({ action, location });
      }
    );
  }

  function go(n) {
    // 仅显示了一个警告T_T
    // ┏━┓ ┏━┓
    // ┃┃┗━┛┃┃
    // ┃┳  ┳ ┃
    // ┗━━━━━┛
    warning(
      canGoWithoutReload,
      'Hash history go(n) causes a full page reload in this browser'
    );

    globalHistory.go(n);
  }

  function goBack() {
    go(-1);
  }

  function goForward() {
    go(1);
  }

  // 计算监听器的数量，用于checkDOMListeners检测是否需要监听hashchange这个dom事件
  let listenerCount = 0;

  // 用于检测是否需要监听hashchange这个dom事件
  function checkDOMListeners(delta) {
    listenerCount += delta;

    if (listenerCount === 1 && delta === 1) {
      window.addEventListener(HashChangeEvent, handleHashChange);
    } else if (listenerCount === 0) {
      window.removeEventListener(HashChangeEvent, handleHashChange);
    }
  }

  let isBlocked = false;
  
  // 允许您注册一个提示消息，该消息将在通知位置侦听器之前显示给用户。 这允许您确保用户想要在离开之前离开当前页面。
  // 和beforeunload的event.returnvalue一样。
  function block(prompt = false) {
    const unblock = transitionManager.setPrompt(prompt);

    if (!isBlocked) {
      checkDOMListeners(1);
      isBlocked = true;
    }

    return () => {
      if (isBlocked) {
        isBlocked = false;
        checkDOMListeners(-1);
      }

      return unblock();
    };
  }

  // 监听函数，用于注册监听器
  function listen(listener) {
    const unlisten = transitionManager.appendListener(listener);
    checkDOMListeners(1);

    return () => {
      checkDOMListeners(-1);
      unlisten();
    };
  }

  // 真正创建的history对象
  const history = {
    length: globalHistory.length,
    action: 'POP',
    location: initialLocation,
    createHref,
    push,
    replace,
    go,
    goBack,
    goForward,
    block,
    listen
  };

  return history;
}

export default createHashHistory;
