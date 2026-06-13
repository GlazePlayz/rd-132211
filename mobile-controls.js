/* =====================================================================
 * mobile-controls.js
 * Touch overlay for the rd-132211 TeaVM port (EaglerAdapter input model)
 *
 * Adds:
 *  - Bottom-left D-pad (forward/back/left/right -> W/A/S/D)
 *  - Bottom-right JUMP button (-> Space)
 *  - Top-right EXIT button (-> Escape)
 *  - Full-screen "look" layer:
 *       drag  -> camera look (mousemove + movementX/Y)
 *       tap   -> left click (destroy block)
 *       hold  -> right click (place block)
 *
 * Include this AFTER classes.js in index.html:
 *   <script src="mobile-controls.js"></script>
 *
 * Only activates on touch devices, unless ?forceMobile=1 is in the URL
 * (handy for testing on desktop via devtools device emulation).
 * ===================================================================== */
(function () {
  "use strict";

  var isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  var force = /forceMobile=1/.test(location.search);
  if (!isTouch && !force) return;

  /* ---------------------------------------------------------------
   * 0. Make sure the page doesn't zoom/scroll under touch
   * ------------------------------------------------------------- */
  (function ensureViewport() {
    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement("meta");
      vp.name = "viewport";
      document.head.appendChild(vp);
    }
    vp.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
  })();

  /* ---------------------------------------------------------------
   * 1. Locate the canvas the game renders to
   * ------------------------------------------------------------- */
  function getCanvas() {
    return document.querySelector("canvas") || document.body;
  }

  /* ---------------------------------------------------------------
   * 2. Key + mouse event synthesis
   * ------------------------------------------------------------- */
  var KEYMAP = {
    forward: { key: "w", code: "KeyW", keyCode: 87 },
    back:    { key: "s", code: "KeyS", keyCode: 83 },
    left:    { key: "a", code: "KeyA", keyCode: 65 },
    right:   { key: "d", code: "KeyD", keyCode: 68 },
    jump:    { key: " ", code: "Space", keyCode: 32 },
    exit:    { key: "Escape", code: "Escape", keyCode: 27 }
  };

  function fireKey(type, def) {
    var ev = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key: def.key,
      code: def.code,
      keyCode: def.keyCode,
      which: def.keyCode
    });
    // Some browsers leave keyCode/which at 0 when set via the constructor
    // dictionary, so force them with defineProperty as a fallback.
    try {
      Object.defineProperty(ev, "keyCode", { get: function () { return def.keyCode; } });
      Object.defineProperty(ev, "which",   { get: function () { return def.keyCode; } });
    } catch (e) { /* ignore if not configurable */ }

    var targets = [window, document, document.body, getCanvas()];
    for (var i = 0; i < targets.length; i++) {
      if (targets[i]) targets[i].dispatchEvent(ev);
    }
  }

  function fireMouseMove(x, y, dx, dy) {
    var canvas = getCanvas();
    var ev = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      movementX: dx,
      movementY: dy
    });
    try {
      Object.defineProperty(ev, "movementX", { get: function () { return dx; } });
      Object.defineProperty(ev, "movementY", { get: function () { return dy; } });
    } catch (e) { /* ignore */ }
    canvas.dispatchEvent(ev);
  }

  function fireMouseButton(type, button, x, y) {
    var canvas = getCanvas();
    var ev = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: button,
      buttons: button === 0 ? 1 : 2,
      clientX: x,
      clientY: y
    });
    canvas.dispatchEvent(ev);
  }

  /* ---------------------------------------------------------------
   * 3. Inject CSS
   * ------------------------------------------------------------- */
  var style = document.createElement("style");
  style.textContent = [
    "#mc-touch-layer{position:fixed;inset:0;z-index:9000;touch-action:none;}",
    "#mc-controls{position:fixed;inset:0;z-index:9001;pointer-events:none;font-family:sans-serif;user-select:none;}",
    ".mc-btn{position:absolute;pointer-events:auto;display:flex;align-items:center;justify-content:center;",
    "  background:rgba(255,255,255,0.18);border:2px solid rgba(255,255,255,0.45);border-radius:14px;",
    "  color:#fff;font-size:26px;font-weight:bold;touch-action:none;-webkit-tap-highlight-color:transparent;}",
    ".mc-btn.active{background:rgba(255,255,255,0.4);}",
    "#mc-dpad{left:14px;bottom:14px;width:180px;height:180px;}",
    "#mc-dpad .mc-btn{width:58px;height:58px;}",
    "#mc-up{left:61px;top:0;}",
    "#mc-down{left:61px;top:122px;}",
    "#mc-left{left:0;top:61px;}",
    "#mc-right{left:122px;top:61px;}",
    "#mc-jump{right:24px;bottom:34px;width:84px;height:84px;border-radius:50%;font-size:16px;}",
    "#mc-exit{top:14px;right:14px;width:42px;height:42px;border-radius:50%;font-size:20px;background:rgba(0,0,0,0.35);}",
  ].join("\n");
  document.head.appendChild(style);

  /* ---------------------------------------------------------------
   * 4. Build the DOM
   * ------------------------------------------------------------- */
  var controls = document.createElement("div");
  controls.id = "mc-controls";
  controls.innerHTML =
    '<div id="mc-dpad">' +
      '<div id="mc-up" class="mc-btn">&#9650;</div>' +
      '<div id="mc-down" class="mc-btn">&#9660;</div>' +
      '<div id="mc-left" class="mc-btn">&#9664;</div>' +
      '<div id="mc-right" class="mc-btn">&#9654;</div>' +
    '</div>' +
    '<div id="mc-jump" class="mc-btn">JUMP</div>' +
    '<div id="mc-exit" class="mc-btn">&#10005;</div>';

  var lookLayer = document.createElement("div");
  lookLayer.id = "mc-touch-layer";

  document.body.appendChild(lookLayer);
  document.body.appendChild(controls);

  /* ---------------------------------------------------------------
   * 5. Hold-button helper (movement / jump)
   *    Tracks one touch per button, releases the key if the finger
   *    slides off the button or lifts.
   * ------------------------------------------------------------- */
  function bindHold(el, def) {
    var activeId = null;

    el.addEventListener("touchstart", function (e) {
      e.preventDefault();
      if (activeId !== null) return;
      activeId = e.changedTouches[0].identifier;
      el.classList.add("active");
      fireKey("keydown", def);
    }, { passive: false });

    el.addEventListener("touchmove", function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier !== activeId) continue;
        var under = document.elementFromPoint(t.clientX, t.clientY);
        if (under !== el) {
          el.classList.remove("active");
          fireKey("keyup", def);
          activeId = null;
        }
      }
    }, { passive: false });

    function release(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeId) {
          el.classList.remove("active");
          fireKey("keyup", def);
          activeId = null;
        }
      }
    }
    el.addEventListener("touchend", release);
    el.addEventListener("touchcancel", release);
  }

  bindHold(document.getElementById("mc-up"), KEYMAP.forward);
  bindHold(document.getElementById("mc-down"), KEYMAP.back);
  bindHold(document.getElementById("mc-left"), KEYMAP.left);
  bindHold(document.getElementById("mc-right"), KEYMAP.right);
  bindHold(document.getElementById("mc-jump"), KEYMAP.jump);

  /* ---------------------------------------------------------------
   * 6. Exit button - tap = Escape (pause / release mouse grab)
   * ------------------------------------------------------------- */
  var exitBtn = document.getElementById("mc-exit");
  exitBtn.addEventListener("touchstart", function (e) {
    e.preventDefault();
    exitBtn.classList.add("active");
  }, { passive: false });
  exitBtn.addEventListener("touchend", function (e) {
    e.preventDefault();
    exitBtn.classList.remove("active");
    fireKey("keydown", KEYMAP.exit);
    fireKey("keyup", KEYMAP.exit);
  });

  /* ---------------------------------------------------------------
   * 7. Look layer:
   *    - drag    -> camera look (mousemove deltas)
   *    - quick tap   -> left click (destroy)
   *    - long press  -> right click (place)
   * ------------------------------------------------------------- */
  var touches = {}; // identifier -> {startX, startY, lastX, lastY, startTime, moved}
  var LONG_PRESS_MS = 350;
  var MOVE_THRESHOLD = 6; // px before a tap becomes a "drag"
  var LOOK_SENSITIVITY = 1.0; // tweak if camera feels too fast/slow

  lookLayer.addEventListener("touchstart", function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      touches[t.identifier] = {
        startX: t.clientX, startY: t.clientY,
        lastX: t.clientX, lastY: t.clientY,
        startTime: Date.now(),
        moved: false
      };
    }
  }, { passive: false });

  lookLayer.addEventListener("touchmove", function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      var rec = touches[t.identifier];
      if (!rec) continue;
      var dx = t.clientX - rec.lastX;
      var dy = t.clientY - rec.lastY;
      if (Math.abs(t.clientX - rec.startX) > MOVE_THRESHOLD ||
          Math.abs(t.clientY - rec.startY) > MOVE_THRESHOLD) {
        rec.moved = true;
      }
      if (rec.moved && (dx !== 0 || dy !== 0)) {
        fireMouseMove(t.clientX, t.clientY, dx * LOOK_SENSITIVITY, dy * LOOK_SENSITIVITY);
      }
      rec.lastX = t.clientX;
      rec.lastY = t.clientY;
    }
  }, { passive: false });

  function endTouch(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      var rec = touches[t.identifier];
      if (!rec) continue;
      delete touches[t.identifier];

      if (!rec.moved) {
        var held = Date.now() - rec.startTime;
        var button = held >= LONG_PRESS_MS ? 2 : 0; // 2 = place, 0 = destroy
        fireMouseButton("mousedown", button, t.clientX, t.clientY);
        fireMouseButton("mouseup", button, t.clientX, t.clientY);
      }
    }
  }
  lookLayer.addEventListener("touchend", endTouch, { passive: false });
  lookLayer.addEventListener("touchcancel", endTouch, { passive: false });

  console.log("[mobile-controls] touch overlay active");
})();
