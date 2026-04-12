(function () {
  CTFd._internal.challenge.data = undefined;

  // Keep the same interface as built-in challenge view scripts so core
  // challenge rendering can invoke the lifecycle hooks safely.
  CTFd._internal.challenge.renderer = null;
  CTFd._internal.challenge.preRender = function () {};
  CTFd._internal.challenge.render = null;
  CTFd._internal.challenge.postRender = function () {};

  function getChallengeData() {
    if (window.Alpine && Alpine.store("challenge")) {
      return Alpine.store("challenge").data || {};
    }
    return CTFd._internal.challenge.data || {};
  }

  function cacheKey(challengeId) {
    return `CTFd:local-docker:instance_${challengeId}`;
  }

  function node(selector) {
    return document.querySelector(selector);
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

  function toCountdown(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  function defaultPanel() {
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
      if (window.localDockerCountdown) {
        clearInterval(window.localDockerCountdown);
      }
      const render = () => {
        const remaining = until - new Date();
        setText(
          "#ldc-count-down",
          remaining > 0 ? toCountdown(remaining) : "Expiring...",
        );
      };
      render();
      window.localDockerCountdown = setInterval(render, 1000);
    }
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

  function request(url, options, timeoutMs) {
    return Promise.race([
      CTFd.fetch(url, options).then(response => response.json()),
      new Promise((_, reject) => setTimeout(() => reject(new Error("request timeout")), timeoutMs)),
    ]);
  }

  function loadInfo() {
    const challenge = getChallengeData();
    if (!challenge.id) {
      return;
    }
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
        defaultPanel();
      });
  }

  function mutate(method, successMessage) {
    const challenge = getChallengeData();
    if (!challenge.id) {
      return;
    }
    const key = cacheKey(challenge.id);
    const verb = method === "POST" ? "Starting container..." : method === "PATCH" ? "Renewing instance..." : "Destroying instance...";
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
    ).then(response => {
      setBusy(false);
      if (!response.success) {
        setStatus(response.message || "Operation failed");
        CTFd._functions.events.eventAlert({
          title: "Fail",
          html: response.message || "Operation failed",
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
          title: "Success",
          html: successMessage,
        });
      }
    }).catch(error => {
      setBusy(false);
      setStatus(error.message || "Operation failed");
      CTFd._functions.events.eventAlert({
        title: "Fail",
        html: error.message || "Operation failed",
      });
    });
  }

  window.localDockerChallenge = {
    loadInfo,
    boot() {
      return mutate("POST", "Container instance created.");
    },
    renew() {
      return mutate("PATCH", "Container instance renewed.");
    },
    destroy() {
      return mutate("DELETE", "Container instance destroyed.");
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
        setStatus("Copy is unavailable in this browser. Open the link and copy it manually.");
        return;
      }
      navigator.clipboard.writeText(value).then(() => {
        setStatus("Connection link copied.");
      }).catch(() => {
        setStatus("Copy failed. Open the link and copy it manually.");
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
