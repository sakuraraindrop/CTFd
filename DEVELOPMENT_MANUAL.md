# CTFd Windows Deploy Development Manual

## Repository

- Remote: `https://github.com/sakuraraindrop/CTFd`
- Branch: `dev/windows-deploy`
- Local path: `D:\project\ctfd`

## Current Purpose

This branch keeps upstream `CTFd` in source mode and adds a local Docker-backed challenge type for Windows/local testing.

The main custom feature is the `local_docker` challenge type:

- Players open the challenge modal in `/challenges`
- The modal shows instance controls such as launch, renew, destroy, restart, copy, and open
- CTFd calls the host `docker` CLI directly
- Challenge images must already exist locally

## Local Startup

The current local startup command is also stored in [run.txt](D:/project/ctfd/run.txt):

```powershell
activate ctfd-win
python serve.py --port 8000 --disable-gevent
```

Current local test URL:

- `http://127.0.0.1:8000/`

Notes:

- Docker Desktop must already be running if you want `local_docker` challenges to work
- The SQLite database in this repo is [CTFd/ctfd.db](D:/project/ctfd/CTFd/ctfd.db)

## Custom Files To Know First

- [CTFd/plugins/local_docker_challenges/__init__.py](D:/project/ctfd/CTFd/plugins/local_docker_challenges/__init__.py)
  Registers the `local_docker` challenge type and implements the instance API.
- [CTFd/plugins/local_docker_challenges/assets/view.html](D:/project/ctfd/CTFd/plugins/local_docker_challenges/assets/view.html)
  Player modal UI for instance controls.
- [CTFd/plugins/local_docker_challenges/assets/view.js](D:/project/ctfd/CTFd/plugins/local_docker_challenges/assets/view.js)
  Player-side instance loading and action logic.
- [local-docker-challenges.md](D:/project/ctfd/local-docker-challenges.md)
  Short design notes for the local Docker challenge behavior.
- [CTFd/themes/core/assets/js/challenges.js](D:/project/ctfd/CTFd/themes/core/assets/js/challenges.js)
  Challenge board UI that opens challenge modals.
- [CTFd/api/v1/challenges.py](D:/project/ctfd/CTFd/api/v1/challenges.py)
  Challenge detail API and view rendering path.

## Recent Fixes Already Applied

- Fixed `local_docker` challenge modal opening by adding the lifecycle hooks expected by the core challenge renderer in [view.js](D:/project/ctfd/CTFd/plugins/local_docker_challenges/assets/view.js)
- Fixed the instance panel being stuck on `Loading...` by removing the plugin script's dependency on a global `$` alias and switching to native DOM access in [view.js](D:/project/ctfd/CTFd/plugins/local_docker_challenges/assets/view.js)

## Expected Workflow For Future Changes

1. Read the relevant custom plugin files first, especially the `local_docker` plugin.
2. Check the current branch and worktree before editing.
3. If the change affects the player challenge modal, inspect both:
   - the challenge board loader in `themes/core`
   - the plugin `view.js` and `view.html`
4. If the change affects instance creation, inspect:
   - `create_instance`
   - `run_docker`
   - the `/api/v1/plugins/local_docker_challenges/instance` routes
5. After editing, do at least:
   - syntax checks for edited JS or Python files
   - a quick local browser/manual verification if the change is UI-facing

## Useful Local Checks

PowerShell examples:

```powershell
git status --short --branch
node --check CTFd\plugins\local_docker_challenges\assets\view.js
python serve.py --port 8000 --disable-gevent
```

If debugging runtime behavior, check:

- [ctfd-stdout.log](D:/project/ctfd/ctfd-stdout.log)
- [ctfd-stderr.log](D:/project/ctfd/ctfd-stderr.log)
- [webchal-stdout.log](D:/project/ctfd/webchal-stdout.log)
- [webchal-stderr.log](D:/project/ctfd/webchal-stderr.log)

## Prompt Template For A New Agent

Use this template in a new conversation and fill in the part after `需求`:

```text
项目路径是 D:\project\ctfd。
请先阅读 D:\project\ctfd\DEVELOPMENT_MANUAL.md，再阅读和需求直接相关的源码后再修改。
当前主要是 dev/windows-deploy 分支，核心自定义功能是 local_docker 题型。
本地启动方式见 D:\project\ctfd\run.txt，当前测试地址通常是 http://127.0.0.1:8000/。
如果需求影响 /challenges 页面、题目弹窗、容器实例创建或 Docker 交互，请优先检查：
- D:\project\ctfd\CTFd\plugins\local_docker_challenges\__init__.py
- D:\project\ctfd\CTFd\plugins\local_docker_challenges\assets\view.html
- D:\project\ctfd\CTFd\plugins\local_docker_challenges\assets\view.js
- D:\project\ctfd\CTFd\themes\core\assets\js\challenges.js
- D:\project\ctfd\CTFd\api\v1\challenges.py

需求：
<把你的具体需求写在这里>

要求：
1. 先定位根因，再直接修改代码
2. 修改后做必要验证
3. 最后告诉我改了什么、为什么改、还剩什么风险
```

## Shorter Prompt Template

```text
项目在 D:\project\ctfd。先看 DEVELOPMENT_MANUAL.md 和相关源码，再直接改代码。
分支是 dev/windows-deploy，核心自定义是 local_docker 题型。
启动方式见 run.txt，测试地址是 http://127.0.0.1:8000/。
需求：<填写需求>
修改后请做必要验证，并说明改动、原因和剩余风险。
```
