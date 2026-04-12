(function () {
  function getChallengeData() {
    if (window.Alpine && Alpine.store("challenge")) {
      return Alpine.store("challenge").data || {};
    }
    return CTFd._internal.challenge.data || {};
  }

  function cacheKey(challengeId) {
    return `CTFd:local-docker:instance_${challengeId}`;
  }

  function toCountdown(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  function defaultPanel() {
    $("#ldc-panel-loading").hide();
    $("#ldc-panel-until").hide();
    $("#ldc-panel-stopped").show();
    $("#ldc-panel-started").hide();
    $("#ldc-connection-info").text("");
  }

  function runningPanel(data) {
    defaultPanel();
    $("#ldc-panel-stopped").hide();
    $("#ldc-panel-started").show();
    $("#ldc-connection-info").text(data.connectionInfo || "");
    if (data.until) {
      $("#ldc-panel-until").show();
      const until = new Date(data.until);
      if (window.localDockerCountdown) {
        clearInterval(window.localDockerCountdown);
      }
      const render = () => {
        const remaining = until - new Date();
        $("#ldc-count-down").text(remaining > 0 ? toCountdown(remaining) : "Expiring...");
      };
      render();
      window.localDockerCountdown = setInterval(render, 1000);
    }
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
      if (!response.success) {
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
      if (successMessage) {
        CTFd._functions.events.eventAlert({
          title: "Success",
          html: successMessage,
        });
      }
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
  };

  CTFd._internal.challenge.postRender = function () {
    loadInfo();
  };
})();
