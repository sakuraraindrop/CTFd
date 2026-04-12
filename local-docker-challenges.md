## Local Docker Challenges

This branch keeps `CTFd` itself in source mode. There is no separate chall-manager, registry, or scenario service.

### Startup

Start CTFd the normal way:

```powershell
activate ctfd-win
python serve.py --port 8000 --disable-gevent
```

For Docker-backed challenges, Docker Desktop must already be running on the host.

Build challenge images separately on the host. Example:

```powershell
docker build -t ezupload-local:latest D:\project\test\ezupload
```

### Challenge Type

A new challenge type named `local_docker` is registered in the source tree.

Admin fields:

- `Container Image`: local Docker image name, e.g. `my-web-challenge:latest`
- `Container Port`: internal container port to publish, e.g. `8080`
- `Port Protocol`: `tcp` or `udp`
- `Connection Scheme`: `http`, `https`, `tcp`, or `udp`
- `Connection Host`: host shown to players, usually `localhost` for local testing
- `Timeout Seconds`: automatic cleanup timeout; `0` disables timeout
- `Sharing`: per-user/team instance or shared instance
- `Destroy On Flag`: destroy the instance after a correct solve

### Runtime Behavior

- Players click `Launch Container` inside the challenge modal.
- CTFd calls the local `docker` CLI directly.
- Containers are launched with `docker run --pull never`, so challenge images must already exist locally.
- Each user or team gets one instance unless `Sharing` is enabled.
- Published host ports are assigned randomly with `docker run -P`.
- Expired instances are cleaned up by a janitor thread started inside the CTFd process.
- The player view includes direct launch, renew, destroy, restart, open, and copy-link actions.
