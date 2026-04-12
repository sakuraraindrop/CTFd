# CTFd Windows Deploy 开发者手册

## 1. 项目概况

### 1.1 仓库信息

- 本地目录：`D:\project\ctfd`
- Git 仓库：`https://github.com/sakuraraindrop/CTFd`
- 当前主要分支：`dev/windows-deploy`
- 上游仓库：`https://github.com/CTFd/CTFd`

### 1.2 当前分支的核心目标

这个分支不是纯上游 CTFd，而是在上游源码基础上做了本地 Windows 测试环境适配，并加入了一个自定义题型：

- `local_docker`

这个题型的设计目标是：

- 在 `/challenges` 页面中，玩家点击题目后打开题目弹窗
- 在题目弹窗内显示实例面板 `Instance Info`
- 玩家可以在弹窗里执行：
  - 启动容器
  - 续期容器
  - 销毁容器
  - 重启容器
  - 复制访问链接
  - 直接打开链接
- CTFd 直接调用宿主机上的 `docker` 命令，不依赖额外的 chall-manager 服务

## 2. 本地环境与启动方式

### 2.1 当前约定的启动方式

项目根目录有 [run.txt](D:/project/ctfd/run.txt)，当前内容是：

```powershell
activate ctfd-win
python serve.py --port 8000 --disable-gevent
```

### 2.2 当前本地测试地址

- `http://127.0.0.1:8000/`

### 2.3 额外前提

- 如果要测试 `local_docker` 题型，必须先启动 Docker Desktop
- 题目镜像必须提前在本机构建完成，因为当前实现使用：
  - `docker run --pull never`
- 当前 SQLite 数据库位置：
  - [CTFd/ctfd.db](D:/project/ctfd/CTFd/ctfd.db)

## 3. 当前分支最重要的自定义模块

后续如果有新的 agent 接手，这几个文件应当优先阅读。

### 3.1 `local_docker` 题型后端

- [CTFd/plugins/local_docker_challenges/__init__.py](D:/project/ctfd/CTFd/plugins/local_docker_challenges/__init__.py)

这个文件负责：

- 注册 `local_docker` 题型
- 定义 `LocalDockerChallengeType`
- 提供实例查询、创建、续期、销毁接口
- 调用本机 `docker` CLI
- 实现实例超时清理线程

如果需求涉及以下内容，必须先看这个文件：

- 点题后实例信息不显示
- 无法启动容器
- 端口映射异常
- 容器销毁/续期/重启异常
- 团队模式/共享实例逻辑
- Docker 调用报错

### 3.2 `local_docker` 玩家弹窗 HTML

- [CTFd/plugins/local_docker_challenges/assets/view.html](D:/project/ctfd/CTFd/plugins/local_docker_challenges/assets/view.html)

这个文件负责：

- 玩家题目弹窗中 `Instance Info` 面板结构
- `Loading...`
- `No running instance for this challenge.`
- `Launch Container`
- 各个实例操作按钮

如果需求涉及：

- 按钮展示
- 面板文案
- 布局样式
- 面板状态切换

优先看这里。

### 3.3 `local_docker` 玩家弹窗 JS

- [CTFd/plugins/local_docker_challenges/assets/view.js](D:/project/ctfd/CTFd/plugins/local_docker_challenges/assets/view.js)

这个文件负责：

- 题目弹窗打开后的实例信息加载
- 与 `/api/v1/plugins/local_docker_challenges/instance` 通信
- 控制面板从 `Loading` 切换到“未运行”或“已运行”
- 处理按钮点击
- 刷新倒计时
- 缓存最近实例信息

这个文件是最近修复最多的前端入口之一，和 `/challenges` 页面行为高度相关。

### 3.4 CTFd 题目详情渲染链路

- [CTFd/themes/core/assets/js/challenges.js](D:/project/ctfd/CTFd/themes/core/assets/js/challenges.js)
- [CTFd/api/v1/challenges.py](D:/project/ctfd/CTFd/api/v1/challenges.py)

这两处负责：

- `/challenges` 页面题目列表
- 点击题目后的详情加载
- challenge 类型对应模板和脚本的动态加载
- challenge modal 的渲染时机

如果出现“点击题目没反应”“弹窗打不开”“自定义题型脚本没执行”，必须沿着这条链路查。

## 4. 当前分支最近已知修复

后续 agent 接手时，不要重复误判这些问题。

### 4.1 修复了 `local_docker` 题目点击无反应

原因：

- CTFd 核心前端在加载题目详情时，会调用题型脚本里的生命周期函数
- `local_docker` 的 `view.js` 之前没有补齐核心前端预期的生命周期接口

处理方式：

- 在 [view.js](D:/project/ctfd/CTFd/plugins/local_docker_challenges/assets/view.js) 中补齐：
  - `CTFd._internal.challenge.data`
  - `CTFd._internal.challenge.renderer`
  - `CTFd._internal.challenge.preRender`
  - `CTFd._internal.challenge.render`
  - `CTFd._internal.challenge.postRender`

### 4.2 修复了 `Instance Info` 一直停在 `Loading...`

原因：

- `local_docker` 的 `view.js` 之前依赖全局 `$`
- 当前 core 主题环境下并不保证这个 `$` 可用
- 导致脚本在第一次操作 DOM 时就报错，实例请求根本没发出去

处理方式：

- 在 [view.js](D:/project/ctfd/CTFd/plugins/local_docker_challenges/assets/view.js) 中改为原生 DOM API

## 5. 推荐的排查顺序

当新 agent 接到需求时，建议按下面顺序处理，不要直接拍脑袋改代码。

### 5.1 先确认需求属于哪一层

常见分类：

- 题目列表页问题
- 题目弹窗问题
- 自定义题型前端脚本问题
- 实例接口问题
- Docker 容器创建问题
- 数据库/题目配置问题
- CTFd 核心模板渲染问题

### 5.2 如果是 `/challenges` 页面相关

先看：

- [CTFd/themes/core/assets/js/challenges.js](D:/project/ctfd/CTFd/themes/core/assets/js/challenges.js)
- [CTFd/api/v1/challenges.py](D:/project/ctfd/CTFd/api/v1/challenges.py)
- [CTFd/plugins/local_docker_challenges/assets/view.js](D:/project/ctfd/CTFd/plugins/local_docker_challenges/assets/view.js)

### 5.3 如果是实例创建/销毁/端口映射相关

先看：

- [CTFd/plugins/local_docker_challenges/__init__.py](D:/project/ctfd/CTFd/plugins/local_docker_challenges/__init__.py)

重点函数：

- `create_instance`
- `get_instance`
- `destroy_instance`
- `run_docker`
- `docker_host_port`
- `build_connection_info`

### 5.4 如果是页面显示异常但后端没报错

优先判断是不是前端脚本执行异常。

检查方式：

- 看浏览器控制台
- 看服务端日志里有没有对应接口请求
- 如果日志里根本没有打到实例 API，请优先怀疑前端脚本提前报错

## 6. 常用调试文件

如果要排查运行时问题，可以先看：

- [ctfd-stdout.log](D:/project/ctfd/ctfd-stdout.log)
- [ctfd-stderr.log](D:/project/ctfd/ctfd-stderr.log)
- [webchal-stdout.log](D:/project/ctfd/webchal-stdout.log)
- [webchal-stderr.log](D:/project/ctfd/webchal-stderr.log)

### 6.1 日志排查建议

如果用户反馈：

- 点题没反应
  - 看是否有 `/api/v1/challenges/<id>` 请求
  - 看是否有 `plugins/local_docker_challenges/assets/view.js` 请求
- 弹窗打开但面板不更新
  - 看是否有 `/api/v1/plugins/local_docker_challenges/instance` 请求
- 点了 `Launch Container` 没效果
  - 看是否有该实例接口的 `POST` 请求
  - 看 Docker CLI 是否报错

## 7. 常用命令

### 7.1 Git 状态

```powershell
git status --short --branch
git branch --show-current
git remote -v
```

### 7.2 运行项目

```powershell
activate ctfd-win
python serve.py --port 8000 --disable-gevent
```

### 7.3 JS 语法检查

```powershell
node --check CTFd\plugins\local_docker_challenges\assets\view.js
```

### 7.4 查找关键代码

```powershell
rg -n "local_docker" CTFd
rg -n "displayChallenge|loadChallenge" CTFd\themes\core\assets\js
rg -n "/api/v1/plugins/local_docker_challenges/instance" CTFd
```

## 8. 修改代码时的约定

后续 agent 在这个仓库里工作时，建议遵守下面约定。

### 8.1 先读上下文再改

不要只根据用户一句话直接改。

至少要先确认：

- 当前分支
- 当前工作区是否干净
- 用户反馈对应的真实链路
- 相关的自定义文件入口

### 8.2 优先做最小修复

这个分支是在上游 CTFd 基础上的定制分支，优先做：

- 局部修复
- 可验证修复
- 不破坏 upstream 行为的修复

不要一上来大改 challenge 渲染链路，除非根因明确。

### 8.3 修改后至少做基本验证

至少做其中一类：

- JS 文件执行 `node --check`
- Python 代码做必要语法/启动验证
- UI 问题做一次本地页面手工验证

如果没做验证，必须明确说明。

## 9. 给新 Agent 的详细提示词模板

下面这份模板是给“新的 agent 对话”直接复制使用的。它的目标是让新 agent 一上来就先读正确文件，而不是在仓库里盲搜半天。

### 9.1 详细版模板

```text
项目路径是 D:\project\ctfd。

请先做下面这些事，再开始修改代码：
1. 先阅读 D:\project\ctfd\DEVELOPMENT_MANUAL.md
2. 再阅读与本次需求直接相关的源码
3. 确认当前分支、工作区状态，以及本地启动方式
4. 定位根因后再改，不要只凭猜测修改

项目信息：
- 仓库：sakuraraindrop/CTFd
- 当前主要分支：dev/windows-deploy
- 这是在上游 CTFd 基础上的定制分支
- 当前最重要的自定义功能是 local_docker 题型

本地环境信息：
- 项目根目录：D:\project\ctfd
- 启动方式见 D:\project\ctfd\run.txt
- 当前本地测试地址通常是：http://127.0.0.1:8000/
- 如果涉及 local_docker 题型，需要默认假设 Docker Desktop 已启动；如果排查容器问题，要检查 docker CLI 调用链路

如果需求涉及 /challenges 页面、题目弹窗、自定义题型、实例面板、Launch Container、续期、销毁、重启、链接显示、容器创建等内容，请优先阅读这些文件：
- D:\project\ctfd\CTFd\plugins\local_docker_challenges\__init__.py
- D:\project\ctfd\CTFd\plugins\local_docker_challenges\assets\view.html
- D:\project\ctfd\CTFd\plugins\local_docker_challenges\assets\view.js
- D:\project\ctfd\CTFd\themes\core\assets\js\challenges.js
- D:\project\ctfd\CTFd\api\v1\challenges.py

如果需求更偏运行时问题，也请检查这些日志文件：
- D:\project\ctfd\ctfd-stdout.log
- D:\project\ctfd\ctfd-stderr.log
- D:\project\ctfd\webchal-stdout.log
- D:\project\ctfd\webchal-stderr.log

本次需求：
<把你的具体需求写在这里>

执行要求：
1. 先说明你判断的根因或候选根因
2. 然后直接改代码，不要只给方案
3. 修改后做必要验证
4. 最后告诉我：
   - 改了哪些文件
   - 为什么这样改
   - 如何验证
   - 还剩哪些风险或未验证项

额外要求：
- 如果发现是前端问题，请明确说明请求有没有真正发到后端
- 如果发现是后端问题，请明确指出是哪一个接口或函数出错
- 如果发现是数据配置问题，请给出具体数据项、字段名或题目类型
```

### 9.2 更强约束版模板

适合你想让新 agent 更稳一点，不要跳步骤时使用。

```text
项目在 D:\project\ctfd。
这是一个基于上游 CTFd 的定制分支，当前主要分支是 dev/windows-deploy，核心自定义功能是 local_docker 题型。

先不要直接改代码，请按这个顺序工作：
1. 阅读 DEVELOPMENT_MANUAL.md
2. 找到和需求直接相关的入口文件
3. 用代码和日志确认根因
4. 再实施最小必要修改
5. 做基本验证后再汇报

本地启动方式见 run.txt，当前测试地址通常是 http://127.0.0.1:8000/。

如果需求和以下内容有关：
- /challenges
- 题目弹窗
- local_docker
- Instance Info
- Loading...
- Launch Container
- Docker 实例创建

请优先阅读：
- CTFd/plugins/local_docker_challenges/__init__.py
- CTFd/plugins/local_docker_challenges/assets/view.html
- CTFd/plugins/local_docker_challenges/assets/view.js
- CTFd/themes/core/assets/js/challenges.js
- CTFd/api/v1/challenges.py

需求如下：
<填写你的需求>

请按以下格式输出结果：
1. 根因
2. 修改内容
3. 验证结果
```

## 10. 给未来接手者的建议

### 10.1 先怀疑链路，再怀疑实现

这个项目最容易踩坑的地方不是某一行代码，而是“没有沿着完整链路排查”。

例如：

- 点题没反应，不一定是后端坏了，可能是题型前端脚本没执行
- 面板一直 `Loading...`，不一定是实例接口慢，可能是前端脚本操作 DOM 时先报错了
- 容器起不来，不一定是 Docker 本身问题，也可能是挑战配置里镜像名、容器端口或连接主机写错了

### 10.2 修改前尽量确认是代码问题还是配置问题

特别是 challenge 相关问题，要先确认：

- 题目 `type` 是什么
- 题目 `state` 是否可见
- 镜像名是否存在于本机
- 容器端口是否正确
- connection host/scheme 是否符合当前本地访问方式

### 10.3 不要忽略本地缓存影响

`view.js` 这类静态脚本文件在浏览器里容易被缓存。

如果用户说“我明明改了还是没效果”，要提醒检查：

- 强制刷新页面
- 是否真的加载了最新脚本
- 服务端日志里是否出现了对应请求
