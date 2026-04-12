import os
import re
import secrets
import subprocess
import threading
import time
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from CTFd.exceptions.challenges import ChallengeCreateException, ChallengeUpdateException
from CTFd.models import Challenges, db
from CTFd.plugins import register_plugin_assets_directory
from CTFd.plugins.challenges import BaseChallenge, CHALLENGE_CLASSES
from CTFd.utils import user as current_user
from CTFd.utils.config import is_teams_mode
from CTFd.utils.decorators import admins_only, authed_only


DOCKER_LABEL = "ctfd.local_docker_instance"
JANITOR_INTERVAL_SECONDS = 15
_JANITOR_STARTED = False
_JANITOR_LOCK = threading.Lock()


class DockerCommandError(Exception):
    pass


class LocalDockerChallenge(Challenges):
    __tablename__ = "local_docker_challenge"
    __mapper_args__ = {"polymorphic_identity": "local_docker"}
    id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE"), primary_key=True
    )
    docker_image = db.Column(db.Text, nullable=False)
    container_port = db.Column(db.Integer, nullable=False)
    port_protocol = db.Column(db.String(8), default="tcp", nullable=False)
    connection_scheme = db.Column(db.String(16), default="http", nullable=False)
    connection_host = db.Column(db.String(255), default="localhost", nullable=False)
    shared = db.Column(db.Boolean, default=False, nullable=False)
    timeout = db.Column(db.Integer, default=0, nullable=False)
    destroy_on_flag = db.Column(db.Boolean, default=False, nullable=False)


class LocalDockerInstance(db.Model):
    __tablename__ = "local_docker_instances"

    id = db.Column(db.Integer, primary_key=True)
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("local_docker_challenge.id", ondelete="CASCADE"), nullable=False
    )
    source_id = db.Column(db.Integer, nullable=False, index=True)
    user_id = db.Column(db.Integer, nullable=True)
    team_id = db.Column(db.Integer, nullable=True)
    container_id = db.Column(db.String(128), nullable=False, unique=True)
    container_name = db.Column(db.String(128), nullable=False)
    host_port = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=True)

    __table_args__ = (
        db.UniqueConstraint("challenge_id", "source_id", name="uq_local_docker_source"),
    )


class LocalDockerChallengeType(BaseChallenge):
    id = "local_docker"
    name = "local_docker"
    templates = {
        "create": "/plugins/local_docker_challenges/assets/create.html",
        "update": "/plugins/local_docker_challenges/assets/update.html",
        "view": "/plugins/local_docker_challenges/assets/view.html",
    }
    scripts = {
        "create": "/plugins/local_docker_challenges/assets/create.js",
        "update": "/plugins/local_docker_challenges/assets/update.js",
        "view": "/plugins/local_docker_challenges/assets/view.js",
    }
    route = "/plugins/local_docker_challenges/assets/"
    blueprint = Blueprint(
        "local_docker_challenges",
        __name__,
        template_folder="templates",
        static_folder="assets",
    )
    challenge_model = LocalDockerChallenge

    @classmethod
    def create(cls, request):
        try:
            data = prepare_challenge_data(request.form or request.get_json())
        except ValueError as exc:
            raise ChallengeCreateException(str(exc)) from exc
        challenge = cls.challenge_model(**data)
        db.session.add(challenge)
        db.session.commit()
        return challenge

    @classmethod
    def read(cls, challenge):
        challenge = LocalDockerChallenge.query.filter_by(id=challenge.id).first()
        data = super().read(challenge)
        data.update(
            {
                "shared": challenge.shared,
                "timeout": challenge.timeout,
                "destroy_on_flag": challenge.destroy_on_flag,
            }
        )
        if current_user.is_admin():
            data.update(
                {
                    "docker_image": challenge.docker_image,
                    "container_port": challenge.container_port,
                    "port_protocol": challenge.port_protocol,
                    "connection_scheme": challenge.connection_scheme,
                    "connection_host": challenge.connection_host,
                }
            )
        return data

    @classmethod
    def update(cls, challenge, request):
        try:
            data = prepare_challenge_data(request.form or request.get_json(), is_update=True)
        except ValueError as exc:
            raise ChallengeUpdateException(str(exc)) from exc
        for attr, value in data.items():
            setattr(challenge, attr, value)
        db.session.commit()
        return challenge

    @classmethod
    def delete(cls, challenge):
        cleanup_instances_for_challenge(challenge.id)
        return super().delete(challenge)

    @classmethod
    def solve(cls, user, team, challenge, request):
        super().solve(user, team, challenge, request)
        if challenge.destroy_on_flag:
            source_id, _, _ = get_source_identity(challenge)
            if source_id is not None:
                destroy_instance(challenge, source_id)


def load(app):
    app.db.create_all()
    CHALLENGE_CLASSES["local_docker"] = LocalDockerChallengeType
    register_plugin_assets_directory(
        app, base_path="/plugins/local_docker_challenges/assets/"
    )
    app.register_blueprint(api_blueprint)
    maybe_start_janitor(app)


api_blueprint = Blueprint("local_docker_api", __name__)


@api_blueprint.route("/api/v1/plugins/local_docker_challenges/instance", methods=["GET"])
@authed_only
def get_instance_route():
    try:
        challenge = get_visible_challenge(request.args.get("challengeId"))
        source_id, _, _ = get_source_identity(challenge)
    except (ValueError, PermissionError) as exc:
        return jsonify({"success": False, "message": str(exc)}), 403
    instance = get_instance(challenge, source_id)
    if instance is None:
        return jsonify({"success": True, "data": {}})
    return jsonify({"success": True, "data": serialize_instance(instance, challenge)})


@api_blueprint.route("/api/v1/plugins/local_docker_challenges/instance", methods=["POST"])
@authed_only
def create_instance_route():
    payload = request.get_json() or {}
    try:
        challenge = get_visible_challenge(payload.get("challengeId"))
        source_id, user_id, team_id = get_source_identity(challenge)
    except (ValueError, PermissionError) as exc:
        return jsonify({"success": False, "message": str(exc)}), 403
    instance = get_instance(challenge, source_id)
    if instance is not None:
        return jsonify({"success": True, "data": serialize_instance(instance, challenge)})

    try:
        instance = create_instance(challenge, source_id, user_id, team_id)
    except DockerCommandError as exc:
        return jsonify({"success": False, "message": str(exc)}), 500
    return jsonify({"success": True, "data": serialize_instance(instance, challenge)})


@api_blueprint.route("/api/v1/plugins/local_docker_challenges/instance", methods=["PATCH"])
@authed_only
def renew_instance_route():
    payload = request.get_json() or {}
    try:
        challenge = get_visible_challenge(payload.get("challengeId"))
        source_id, _, _ = get_source_identity(challenge)
    except (ValueError, PermissionError) as exc:
        return jsonify({"success": False, "message": str(exc)}), 403
    instance = get_instance(challenge, source_id)
    if instance is None:
        return jsonify({"success": False, "message": "instance not found"}), 404

    instance.expires_at = compute_expiry(challenge.timeout)
    db.session.commit()
    return jsonify(
        {
            "success": True,
            "data": {
                "message": "Instance renewed",
                **serialize_instance(instance, challenge),
            },
        }
    )


@api_blueprint.route("/api/v1/plugins/local_docker_challenges/instance", methods=["DELETE"])
@authed_only
def delete_instance_route():
    payload = request.get_json() or {}
    try:
        challenge = get_visible_challenge(payload.get("challengeId"))
        source_id, _, _ = get_source_identity(challenge)
    except (ValueError, PermissionError) as exc:
        return jsonify({"success": False, "message": str(exc)}), 403
    destroy_instance(challenge, source_id)
    return jsonify({"success": True, "data": {}})


def prepare_challenge_data(data, is_update=False):
    prepared = dict(data)

    for key in ["container_port", "timeout", "value", "position", "max_attempts"]:
        if key in prepared:
            prepared[key] = int(prepared[key]) if str(prepared[key]).strip() else 0

    for key in ["shared", "destroy_on_flag"]:
        if key in prepared:
            prepared[key] = str(prepared[key]).lower() in {"true", "1", "yes", "on"}

    for key in ["docker_image", "port_protocol", "connection_scheme", "connection_host"]:
        if key in prepared and isinstance(prepared[key], str):
            prepared[key] = prepared[key].strip()

    if not prepared.get("docker_image"):
        raise ValueError("docker_image is required")
    if int(prepared.get("container_port", 0)) <= 0:
        raise ValueError("container_port must be greater than 0")

    prepared["function"] = "static"
    prepared["connection_info"] = None

    if not is_update:
        prepared.setdefault("state", "hidden")
        prepared.setdefault("logic", "any")
        prepared.setdefault("max_attempts", 0)
        prepared.setdefault("position", 0)
    return prepared


def get_visible_challenge(raw_id):
    try:
        challenge_id = int(raw_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid challenge id") from exc
    challenge = LocalDockerChallenge.query.filter_by(id=challenge_id).first()
    if challenge is None:
        raise ValueError("challenge not found")
    if challenge.state != "visible" and not current_user.is_admin():
        raise PermissionError("challenge not visible")
    return challenge


def get_source_identity(challenge):
    user = current_user.get_current_user()
    user_id = int(user.id)
    team_id = int(user.team_id) if getattr(user, "team_id", None) else None

    if challenge.shared:
        return 0, user_id, team_id

    if is_teams_mode():
        if team_id is None:
            raise PermissionError("user has no team")
        return team_id, user_id, team_id

    return user_id, user_id, team_id


def serialize_instance(instance, challenge):
    return {
        "connectionInfo": build_connection_info(challenge, instance.host_port),
        "since": to_iso(instance.created_at),
        "until": to_iso(instance.expires_at),
    }


def to_iso(value):
    if value is None:
        return None
    return value.replace(microsecond=0).isoformat() + "Z"


def build_connection_info(challenge, host_port):
    return f"{challenge.connection_scheme}://{challenge.connection_host}:{host_port}"


def compute_expiry(timeout_seconds):
    if timeout_seconds and timeout_seconds > 0:
        return datetime.utcnow() + timedelta(seconds=timeout_seconds)
    return None


def get_instance(challenge, source_id):
    instance = LocalDockerInstance.query.filter_by(
        challenge_id=challenge.id, source_id=source_id
    ).first()
    if instance is None:
        return None
    if instance.expires_at and instance.expires_at <= datetime.utcnow():
        destroy_instance_record(instance)
        return None
    if not docker_container_running(instance.container_id):
        destroy_instance_record(instance, remove_container=False)
        return None
    return instance


def create_instance(challenge, source_id, user_id, team_id):
    ensure_docker_ready()
    container_name = (
        f"ctfd-c{challenge.id}-s{source_id}-{secrets.token_hex(4)}"
    )[:63]
    port_key = f"{challenge.container_port}/{challenge.port_protocol}"
    labels = {
        DOCKER_LABEL: "1",
        "ctfd.challenge_id": str(challenge.id),
        "ctfd.source_id": str(source_id),
    }

    args = ["run", "-d", "-P", "--pull", "never", "--name", container_name]
    for key, value in labels.items():
        args.extend(["--label", f"{key}={value}"])
    args.append(challenge.docker_image)

    container_id = run_docker(args, timeout=60).strip()
    host_port = None
    for _ in range(10):
        host_port = docker_host_port(container_id, port_key)
        if host_port is not None:
            break
        time.sleep(0.5)
    if host_port is None:
        remove_container(container_id)
        raise DockerCommandError(f"failed to resolve published port for {port_key}")

    instance = LocalDockerInstance(
        challenge_id=challenge.id,
        source_id=source_id,
        user_id=user_id,
        team_id=team_id,
        container_id=container_id,
        container_name=container_name,
        host_port=host_port,
        created_at=datetime.utcnow(),
        expires_at=compute_expiry(challenge.timeout),
    )
    db.session.add(instance)
    db.session.commit()
    return instance


def destroy_instance(challenge, source_id):
    instance = LocalDockerInstance.query.filter_by(
        challenge_id=challenge.id, source_id=source_id
    ).first()
    if instance is None:
        return
    destroy_instance_record(instance)


def cleanup_instances_for_challenge(challenge_id):
    instances = LocalDockerInstance.query.filter_by(challenge_id=challenge_id).all()
    for instance in instances:
        destroy_instance_record(instance)


def destroy_instance_record(instance, remove_container=True):
    if remove_container:
        remove_container_safe(instance.container_id)
    db.session.delete(instance)
    db.session.commit()


def ensure_docker_ready():
    run_docker(["version", "--format", "{{.Server.Version}}"], timeout=15)


def docker_container_running(container_id):
    try:
        output = run_docker(
            ["inspect", "-f", "{{json .State.Running}}", container_id], timeout=15
        )
    except DockerCommandError:
        return False
    return output.strip().lower() == "true"


def docker_host_port(container_id, port_key):
    try:
        output = run_docker(["port", container_id, port_key], timeout=15)
    except DockerCommandError:
        return None
    line = output.strip().splitlines()[0] if output.strip() else ""
    match = re.search(r":(\d+)$", line)
    return int(match.group(1)) if match else None


def remove_container(container_id):
    run_docker(["rm", "-f", container_id], timeout=30)


def remove_container_safe(container_id):
    try:
        remove_container(container_id)
    except DockerCommandError:
        pass


def run_docker(args, timeout=30):
    completed = subprocess.run(
        ["docker", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if completed.returncode != 0:
        stderr = completed.stderr.strip() or completed.stdout.strip() or "docker command failed"
        raise DockerCommandError(stderr)
    return completed.stdout


def maybe_start_janitor(app):
    global _JANITOR_STARTED
    with _JANITOR_LOCK:
        if _JANITOR_STARTED:
            return
        if app.debug and os.environ.get("WERKZEUG_RUN_MAIN") != "true":
            return
        thread = threading.Thread(target=janitor_loop, args=(app,), daemon=True)
        thread.start()
        _JANITOR_STARTED = True


def janitor_loop(app):
    while True:
        with app.app_context():
            now = datetime.utcnow()
            expired = LocalDockerInstance.query.filter(
                LocalDockerInstance.expires_at.isnot(None),
                LocalDockerInstance.expires_at <= now,
            ).all()
            for instance in expired:
                destroy_instance_record(instance)
        time.sleep(JANITOR_INTERVAL_SECONDS)
