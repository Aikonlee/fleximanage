#!/bin/bash
set -euo pipefail

# MongoDB 7.0.25 Replica Set Helper (3-node) -- ARM64 version for Ubuntu 24.04

MONGO_VERSION="7.0.25"
DIST_SUFFIX="ubuntu2404"
ARCH="arm64"
MONGO_DOWNLOAD_URL="https://fastdl.mongodb.org/linux/mongodb-linux-aarch64-${DIST_SUFFIX}-${MONGO_VERSION}.tgz"
MONGOSH_DOWNLOAD_URL="https://downloads.mongodb.com/compass/mongosh-2.2.10-linux-arm64.tgz"
MONGO_INSTALL_DIR="/opt/mongodb-${MONGO_VERSION}"
DATA_BASE_DIR="/data/db"
REPLICA_SET_NAME="rs"
LOG_DIR="/var/log/mongodb"
RS_HOST="${MONGO_HOST:-127.0.0.1}"
PORT_RANGE_START=27017
PORT_RANGE_END=27029
OPLOG_SIZE_MB=${OPLOG_SIZE_MB:-256}

for arg in "$@"; do [[ "$arg" == *=* ]] && key="${arg%%=*}" && val="${arg#*=}" && export "$key"="$val"; done

CLEAN=${CLEAN:-0}
STOP=${STOP:-0}
STATUS=${STATUS:-0}
MAX_INSTANCES=3

log(){ echo "[$(date +'%Y-%m-%dT%H:%M:%SZ')] $*"; }
error_exit(){ log "ERROR: $1"; exit 1; }

mongo_my_state(){
        local port="$1"
        if [[ -f "/opt/mongodb-current/bin/mongosh" ]]; then
            "/opt/mongodb-current/bin/mongosh" --port "$port" --quiet --eval 'try { var s = rs.status(); s.myState } catch(e) { -1 }' 2>/dev/null || echo -1
        else
            echo -1
        fi
}

if [[ "$STOP" == 1 && "$CLEAN" == 1 ]]; then echo "ERROR: STOP=1 and CLEAN=1 cannot be combined" >&2; exit 1; fi

if [[ "$STOP" == 1 ]]; then
        log "STOP=1: stopping mongod processes"
        pids=$(pgrep -f "/data/db270" || true)
        if [[ -z "$pids" ]]; then log "No mongod processes"; exit 0; fi
        kill $pids 2>/dev/null || true; sleep 2
        leftover=$(pgrep -f "/data/db270" || true)
        [[ -n "$leftover" ]] && kill -9 $leftover 2>/dev/null || true
        log "Stopped."; exit 0
fi

if [[ "$STATUS" == 1 ]]; then
        log "STATUS=1"
        if [[ -f "/opt/mongodb-current/bin/mongosh" ]]; then
            for port in $(seq $PORT_RANGE_START $PORT_RANGE_END); do
                    if pgrep -f "mongod.*--port=$port" >/dev/null; then
                            state=$(mongo_my_state "$port")
                            case "$state" in
                                    1) role=PRIMARY;; 2) role=SECONDARY;; 0|3|5) role=STARTING;; 7) role=ARBITER;; 8) role=DOWN;; 9) role=ROLLBACK;; 10) role=REMOVED;; -1) role=RUNNING_ERR;; *) role=UNKNOWN_$state;;
                            esac
                            log "Port $port: $role"
                    else
                            log "Port $port: STOPPED"
                    fi
            done
        else
            pgrep -afl mongod || log "No mongod processes"
        fi
        exit 0
fi

log "[1/7] Checking system compatibility for MongoDB ${MONGO_VERSION}"

if [[ $(uname -m) != "aarch64" ]]; then
    log "WARNING: This script is designed for ARM64 (aarch64) architecture"
    read -p "Continue anyway? (y/N): " -n 1 -r
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 1; fi
    echo
fi

if ! grep -q "24.04" /etc/os-release 2>/dev/null; then
    log "WARNING: This script is designed for Ubuntu 24.04"
    read -p "Continue anyway? (y/N): " -n 1 -r
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 1; fi
    echo
fi

log "[2/7] Installing dependencies"
rm -f /etc/apt/sources.list.d/mongodb-org-8.0.list 2>/dev/null || true
apt-get update || true
apt-get install -y wget curl libcurl4 libgssapi-krb5-2 libwrap0 libsasl2-2 libsasl2-modules libsasl2-modules-gssapi-mit libnuma1 snmp libldap-common libldap2 || error_exit "Failed to install dependencies"

# Check if MongoDB is already installed and working
if [[ -f "/opt/mongodb-current/bin/mongod" ]] && /opt/mongodb-current/bin/mongod --version >/dev/null 2>&1; then
    log "MongoDB is already installed, checking if we need to reinstall..."
    if [[ "$CLEAN" == 1 ]]; then
        log "CLEAN=1: Reinstalling MongoDB"
    else
        log "Skipping MongoDB installation, proceeding to instance startup"
        goto_start_instances=true
    fi
fi

if [[ "$goto_start_instances" != "true" ]]; then
    log "[3/7] Downloading MongoDB ${MONGO_VERSION}"
    DOWNLOAD_PATH="/tmp/mongodb-${MONGO_VERSION}.tgz"
    rm -f "$DOWNLOAD_PATH"

    for attempt in {1..3}; do
        log "Download attempt $attempt"
        if wget -qO "$DOWNLOAD_PATH" "$MONGO_DOWNLOAD_URL"; then
            if [[ -s "$DOWNLOAD_PATH" ]] && tar -tzf "$DOWNLOAD_PATH" >/dev/null 2>&1; then
                file_size=$(stat -c%s "$DOWNLOAD_PATH" 2>/dev/null || stat -f%z "$DOWNLOAD_PATH")
                log "Download verified successfully ($file_size bytes)"
                break
            else
                log "Download appears corrupted, retrying..."
                rm -f "$DOWNLOAD_PATH"
            fi
        fi
        [[ $attempt -eq 3 ]] && error_exit "Failed to download MongoDB after 3 attempts"
        sleep 2
    done

    log "[4/7] Extracting and installing MongoDB Server"
    rm -rf "$MONGO_INSTALL_DIR"
    mkdir -p "$MONGO_INSTALL_DIR"

    log "Extracting MongoDB..."
    if ! tar -xzf "$DOWNLOAD_PATH" -C "$MONGO_INSTALL_DIR" --strip-components=1; then
        log "Standard extraction failed, trying alternative method..."
        cd /tmp
        rm -rf "mongodb-linux-aarch64-${DIST_SUFFIX}-${MONGO_VERSION}"
        if tar -xzf "$DOWNLOAD_PATH"; then
            mv "mongodb-linux-aarch64-${DIST_SUFFIX}-${MONGO_VERSION}"/* "$MONGO_INSTALL_DIR"/
            rm -rf "mongodb-linux-aarch64-${DIST_SUFFIX}-${MONGO_VERSION}"
        else
            error_exit "Failed to extract MongoDB tarball with both methods"
        fi
    fi

    [[ ! -f "$MONGO_INSTALL_DIR/bin/mongod" ]] && error_exit "MongoDB server binaries not found after extraction"

    # Download MongoDB Shell if not present
    if [[ ! -f "$MONGO_INSTALL_DIR/bin/mongosh" ]]; then
        log "Downloading MongoDB Shell..."
        MONGOSH_DOWNLOAD_PATH="/tmp/mongosh-2.2.10.tgz"
        if wget -qO "$MONGOSH_DOWNLOAD_PATH" "$MONGOSH_DOWNLOAD_URL"; then
            cd /tmp
            tar -xzf "$MONGOSH_DOWNLOAD_PATH"
            cp mongosh-2.2.10-linux-arm64/bin/mongosh "$MONGO_INSTALL_DIR/bin/" 2>/dev/null || true
            rm -rf mongosh-2.2.10-linux-arm64
            log "MongoDB Shell installed successfully"
        else
            log "WARNING: Failed to download MongoDB Shell"
        fi
    fi

    rm -f /opt/mongodb-current
    ln -sfn "$MONGO_INSTALL_DIR" /opt/mongodb-current

    if ! id "mongodb" &>/dev/null; then
        useradd -r -s /bin/false -d /var/lib/mongodb -U mongodb
    fi
fi

log "[5/7] Creating data dirs"
USED_PORTS=()
for port in $(seq $PORT_RANGE_START $PORT_RANGE_END); do
        [[ ${#USED_PORTS[@]} -ge $MAX_INSTANCES ]] && break
        if ss -tuln | grep -q ":$port "; then error_exit "Port $port in use (use CLEAN=1)"; fi
        d="${DATA_BASE_DIR}$port"; mkdir -p "$d"; USED_PORTS+=("$port")
done
[[ ${#USED_PORTS[@]} -eq $MAX_INSTANCES ]] || error_exit "Failed to allocate $MAX_INSTANCES ports"

if [[ "$CLEAN" == 1 ]]; then
        log "CLEAN=1 removing old processes & data"
        pids=$(pgrep -f mongod || true)
        [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
        for i in {1..10}; do
                busy=0; for port in $(seq $PORT_RANGE_START $PORT_RANGE_END); do ss -tuln | grep -q ":$port " && busy=1; done
                [[ $busy -eq 0 ]] && break; sleep 1
        done
        rm -rf /data/db270* || true
        rm -f /tmp/mongodb-*.sock
fi

chown -R mongodb:mongodb "$DATA_BASE_DIR"270* 2>/dev/null || true

log "[6/7] Starting instances"
mkdir -p "$LOG_DIR"; chown -R mongodb:mongodb "$LOG_DIR"
rm -f /tmp/mongodb-*.sock

log "Testing MongoDB binary..."
/opt/mongodb-current/bin/mongod --version || error_exit "MongoDB binary test failed"

instances_running=0
for port in "${USED_PORTS[@]}"; do
    ss -tuln | grep -q ":$port " && ((instances_running++))
done

if [[ $instances_running -eq $MAX_INSTANCES ]]; then
    log "All MongoDB instances are already running"
else
    for port in "${USED_PORTS[@]}"; do
        ss -tuln | grep -q ":$port " && continue
        
        log "Starting port $port"
        rm -f "/tmp/mongodb-${port}.sock"
        
        if sudo -u mongodb /opt/mongodb-current/bin/mongod \
            --port=$port \
            --dbpath "${DATA_BASE_DIR}$port" \
            --replSet "$REPLICA_SET_NAME" \
            --bind_ip_all \
            --oplogSize $OPLOG_SIZE_MB \
            --wiredTigerCacheSizeGB 0.25 \
            --fork \
            --logpath "$LOG_DIR/mongod-$port.log"; then
            
            sleep 2
            if ss -tuln | grep -q ":$port "; then
                log "Instance $port started successfully"
            else
                log "WARNING: Port $port not listening"
                [[ -f "$LOG_DIR/mongod-$port.log" ]] && tail -20 "$LOG_DIR/mongod-$port.log" || true
                error_exit "Instance $port failed to start"
            fi
        else
            log "ERROR: mongod launch failed for $port"
            [[ -f "$LOG_DIR/mongod-$port.log" ]] && tail -30 "$LOG_DIR/mongod-$port.log" || true
            error_exit "Failed to start MongoDB on port $port"
        fi
    done
fi

log "[7/7] Replica set initialization"

if [[ -f "/opt/mongodb-current/bin/mongosh" ]]; then
    MONGO_BIN="/opt/mongodb-current/bin/mongosh"
    log "Using MongoDB Shell for replica set configuration"
    
    sleep 8

    REPLICA_CONFIG="{ _id: \"${REPLICA_SET_NAME}\", members: [ { _id: 0, host: \"${RS_HOST}:${USED_PORTS[0]}\" }, { _id: 1, host: \"${RS_HOST}:${USED_PORTS[1]}\" }, { _id: 2, host: \"${RS_HOST}:${USED_PORTS[2]}\" } ] }"

    existing_status=$($MONGO_BIN --port "${USED_PORTS[0]}" --quiet --eval 'try { rs.status().ok } catch(e){ 0 }' 2>/dev/null || echo 0)

    if [[ "$existing_status" == "1" ]]; then
        log "Replica set already initialized"
    else
        log "Running rs.initiate()"
        $MONGO_BIN --port "${USED_PORTS[0]}" --eval "rs.initiate($REPLICA_CONFIG)" >/dev/null 2>&1 || log "WARNING: Replica set initialization may have failed"
    fi

    sleep 10

    log "Waiting for PRIMARY node..."
    primary_ok=0
    for i in {1..60}; do
        for port in "${USED_PORTS[@]}"; do
            state=$(mongo_my_state "$port")
            if [[ "$state" == "1" ]]; then
                primary_ok=1
                log "PRIMARY ready on port $port (attempt $i)"
                break 2
            fi
        done
        sleep 2
    done

    if [[ $primary_ok -eq 1 ]]; then
        log "Replica set is healthy with PRIMARY node"
    else
        log "WARNING: PRIMARY not ready after wait"
    fi
else
    log "WARNING: MongoDB Shell not available, skipping replica set initialization"
fi

log "---"
log "MongoDB ${MONGO_VERSION} deployment completed"
log "Ports: ${USED_PORTS[*]}"
log "Replica Set: $REPLICA_SET_NAME"
log "Logs: $LOG_DIR/mongod-*.log"
[[ -f "/opt/mongodb-current/bin/mongosh" ]] && log "Connect: mongosh --port ${USED_PORTS[0]}"
log "Use: bash $0 STATUS=1 | STOP=1 | CLEAN=1"
exit 0