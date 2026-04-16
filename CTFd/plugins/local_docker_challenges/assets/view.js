(function () {
  CTFd._internal.challenge.data = undefined;

  // Keep the same interface as built-in challenge view scripts so core
  // challenge rendering can invoke the lifecycle hooks safely.
  CTFd._internal.challenge.renderer = null;
  CTFd._internal.challenge.preRender = function () {};
  CTFd._internal.challenge.render = null;
  CTFd._internal.challenge.postRender = function () {};

  let activeLoadToken = 0;
  let modalCleanupBound = false;

  function getChallengeData() {
    if (window.Alpine && Alpine.store("challenge")) {
      return Alpine.store("challenge").data || {};
    }
    return CTFd._internal.challenge.data || {};
  }

  function cacheKey(challengeId) {
    return `CTFd:local-docker:instance_${challengeId}`;
  }

  function getModalRoot() {
    return document.querySelector("#challenge-window");
  }

  function node(selector) {
    const root = getModalRoot();
    return root ? root.querySelector(selector) : null;
  }

  function show(selector) {
    const el = node(selector);
    if (el) {
      el.style.display = "";
    }
  }

  function hide(selector) {
    const el = node(selector);
    if (el) {
      el.style.display = "none";
    }
  }

  function setText(selector, value) {
    const el = node(selector);
    if (el) {
      el.textContent = value;
    }
  }

  function getText(selector) {
    const el = node(selector);
    return el ? el.textContent : "";
  }

  function setAttr(selector, name, value) {
    const el = node(selector);
    if (el) {
      el.setAttribute(name, value);
    }
  }

  function getAttr(selector, name) {
    const el = node(selector);
    return el ? el.getAttribute(name) : null;
  }

  function setDisabled(selector, disabled) {
    const el = node(selector);
    if (el) {
      el.disabled = disabled;
    }
  }

  function clearCountdown() {
    if (window.localDockerCountdown) {
      clearInterval(window.localDockerCountdown);
      window.localDockerCountdown = null;
    }
  }

  function toCountdown(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  function setBusy(busy) {
    const buttons = [
      "#ldc-boot-button",
      "#ldc-copy-button",
      "#ldc-open-button",
      "#ldc-renew-button",
      "#ldc-destroy-button",
      "#ldc-restart-button",
    ];
    buttons.forEach(selector => setDisabled(selector, busy));
  }

  function setStatus(message) {
    if (message) {
      setText("#ldc-inline-status", message);
      show("#ldc-inline-status");
      return;
    }
    hide("#ldc-inline-status");
    setText("#ldc-inline-status", "");
  }

  function showLoadingPanel() {
    clearCountdown();
    show("#ldc-panel-loading");
    hide("#ldc-panel-stopped");
    hide("#ldc-panel-started");
    hide("#ldc-panel-until");
    setText("#ldc-connection-info", "");
    setAttr("#ldc-connection-link", "href", "#");
    setStatus("");
    setBusy(false);
  }

  function defaultPanel() {
    clearCountdown();
    hide("#ldc-panel-loading");
    hide("#ldc-panel-until");
    show("#ldc-panel-stopped");
    hide("#ldc-panel-started");
    setText("#ldc-connection-info", "");
    setAttr("#ldc-connection-link", "href", "#");
    setStatus("");
    setBusy(false);
  }

  function runningPanel(data) {
    defaultPanel();
    hide("#ldc-panel-stopped");
    show("#ldc-panel-started");
    setText("#ldc-connection-info", data.connectionInfo || "");
    setAttr("#ldc-connection-link", "href", data.connectionInfo || "#");

    if (data.until) {
      show("#ldc-panel-until");
      const until = new Date(data.until);

      const render = () => {
        const remaining = until - new Date();
        setText(
          "#ldc-count-down",
          remaining > 0 ? toCountdown(remaining) : "即将到期...",
        );
      };

      render();
      clearCountdown();
      window.localDockerCountdown = setInterval(render, 1000);
    }
  }

  function request(url, options, timeoutMs) {
    return Promise.race([
      CTFd.fetch(url, options).then(response => response.json()),
      new Promise((_, reject) => setTimeout(() => reject(new Error("request timeout")), timeoutMs)),
    ]);
  }

  function bindModalCleanup() {
    const root = getModalRoot();
    if (!root || modalCleanupBound) {
      return;
    }

    root.addEventListener("hidden.bs.modal", () => {
      clearCountdown();
      setStatus("");
      setBusy(false);
      activeLoadToken += 1;
    });

    modalCleanupBound = true;
  }

  function loadInfo(retryCount = 0) {
    bindModalCleanup();

    const challenge = getChallengeData();
    if (!challenge.id) {
      if (retryCount < 6) {
        setTimeout(() => loadInfo(retryCount + 1), 50);
      } else {
        defaultPanel();
      }
      return;
    }

    const loadToken = ++activeLoadToken;
    const key = cacheKey(challenge.id);
    const cached = localStorage.getItem(key);

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.data && parsed.receivedAt) {
          const age = new Date() - new Date(parsed.receivedAt);
          if (age < 15000) {
            runningPanel(parsed.data);
            return;
          }
        }
      } catch (error) {
        localStorage.removeItem(key);
      }
    }

    showLoadingPanel();

    request(
      `/api/v1/plugins/local_docker_challenges/instance?challengeId=${challenge.id}`,
      {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      },
      4000,
    )
      .then(response => {
        if (loadToken !== activeLoadToken) {
          return;
        }

        if (response.success && response.data && response.data.since) {
          localStorage.setItem(
            key,
            JSON.stringify({ data: response.data, receivedAt: new Date().toISOString() }),
          );
          runningPanel(response.data);
          return;
        }

        localStorage.removeItem(key);
        defaultPanel();
      })
      .catch(() => {
        if (loadToken !== activeLoadToken) {
          return;
        }
        defaultPanel();
      });
  }

  function mutate(method, successMessage) {
    const challenge = getChallengeData();
    if (!challenge.id) {
      return Promise.resolve();
    }

    const key = cacheKey(challenge.id);
    const verb =
      method === "POST"
        ? "正在启动容器..."
        : method === "PATCH"
          ? "正在续期实例..."
          : "正在销毁实例...";

    setBusy(true);
    setStatus(verb);

    return request(
      "/api/v1/plugins/local_docker_challenges/instance",
      {
        method,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ challengeId: challenge.id }),
      },
      30000,
    )
      .then(response => {
        setBusy(false);

        if (!response.success) {
          setStatus(response.message || "操作失败");
          CTFd._functions.events.eventAlert({
            title: "失败",
            html: response.message || "操作失败",
          });
          return;
        }

        if (response.data && response.data.since) {
          localStorage.setItem(
            key,
            JSON.stringify({ data: response.data, receivedAt: new Date().toISOString() }),
          );
        } else {
          localStorage.removeItem(key);
        }

        loadInfo();
        setStatus(successMessage || "");

        if (successMessage) {
          CTFd._functions.events.eventAlert({
            title: "成功",
            html: successMessage,
          });
        }
      })
      .catch(error => {
        setBusy(false);
        setStatus(error.message || "操作失败");
        CTFd._functions.events.eventAlert({
          title: "失败",
          html: error.message || "操作失败",
        });
      });
  }

  window.localDockerChallenge = {
    loadInfo,
    boot() {
      return mutate("POST", "容器实例已创建。");
    },
    renew() {
      return mutate("PATCH", "容器实例已续期。");
    },
    destroy() {
      return mutate("DELETE", "容器实例已销毁。");
    },
    restart() {
      return this.destroy().then(() => this.boot());
    },
    copyConnection() {
      const value = getText("#ldc-connection-info");
      if (!value) {
        return;
      }

      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        setStatus("当前浏览器不支持复制，请手动复制。");
        return;
      }

      navigator.clipboard.writeText(value)
        .then(() => {
          setStatus("链接已复制。");
        })
        .catch(() => {
          setStatus("复制失败，请手动复制。");
        });
    },
    openConnection() {
      const url = getAttr("#ldc-connection-link", "href");
      if (!url || url === "#") {
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    },
  };

  CTFd._internal.challenge.postRender = function () {
    loadInfo();
  };
})();
