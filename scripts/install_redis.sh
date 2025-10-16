#!/bin/bash
set -euo pipefail

# MongoDB 8.0.15 Replica Set Helper (3-node) -- ARM64 version for Ubuntu 24.04

MONGO_VERSION="8.0.15"
DIST_SUFFIX="ubuntu2404"
ARCH="arm64"
MONGO_DOWNLOAD_URL="https://fastdl.mongodb.org/linux/mongodb-linux-aarch64-${DIST_SUFFIX}-${MONGO_VERSION}.tgz"
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
        # Match any mongod we started (dbpath /data/db270XX) rather than relying on --port syntax
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
            MONGO_BIN="/opt/mongodb-current/bin/mongosh"
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

# Check if running on ARM64 architecture
if [[ $(uname -m) != "aarch64" ]]; then
    log "WARNING: This script is designed for ARM64 (aarch64) architecture, but detected: $(uname -m)"
    read -p "Continue anyway? (y/N): " -n 1 -r
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
    echo
fi

# Check Ubuntu version
if ! grep -q "24.04" /etc/os-release 2>/dev/null; then
    log "WARNING: This script is designed for Ubuntu 24.04, but detected:"
    cat /etc/os-release | grep PRETTY_NAME || true
    read -p "Continue anyway? (y/N): " -n 1 -r
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
    echo
fi

log "[2/7] Installing dependencies"
# Remove MongoDB repository to avoid GPG errors
rm -f /etc/apt/sources.list.d/mongodb-org-8.0.list 2>/dev/null || true

# Update package list ignoring any repository errors
apt-get update || true

# Install basic dependencies that should be available
apt-get install -y wget curl || error_exit "Failed to install wget/curl"

# Now install MongoDB dependencies with correct Ubuntu 24.04 package names
apt-get install -y libcurl4 libgssapi-krb5-2 libwrap0 libsasl2-2 libsasl2-modules libsasl2-modules-gssapi-mit libnuma1 snmp libldap-common libldap2 || error_exit "Failed to install dependencies"

# Check if MongoDB is already installed
if [[ -f "/opt/mongodb-current/bin/mongod" ]]; then
    log "MongoDB appears to be already installed, checking if we need to reinstall..."
    if [[ "$CLEAN" == 1 ]]; then
        log "CLEAN=1: Reinstalling MongoDB"
    else
        log "MongoDB already installed, skipping download and extraction"
        log "Proceeding to start instances and configure replica set"
        # Skip download and extraction, proceed directly to startup phase
        goto_start_instances=true
    fi
fi

if [[ "$goto_start_instances" != "true" ]]; then
    log "[3/7] Downloading MongoDB ${MONGO_VERSION}"
    DOWNLOAD_PATH="/tmp/mongodb-${MONGO_VERSION}.tgz"

    # Remove any existing corrupted download
    rm -f "$DOWNLOAD_PATH"

    # Download with retry mechanism
    for attempt in {1..3}; do
        log "Download attempt $attempt"
        if wget -qO "$DOWNLOAD_PATH" "$MONGO_DOWNLOAD_URL"; then
            # Verify download size and integrity
            if [[ -s "$DOWNLOAD_PATH" ]]; then
                file_size=$(stat -c%s "$DOWNLOAD_PATH" 2>/dev/null || stat -f%z "$DOWNLOAD_PATH")
                log "Downloaded file size: $file_size bytes"
                
                # Check if file is a valid tar archive
                if tar -tzf "$DOWNLOAD_PATH" >/dev/null 2>&1; then
                    log "Download verified successfully"
                    break
                else
                    log "Download appears corrupted, retrying..."
                    rm -f "$DOWNLOAD_PATH"
                fi
            else
                log "Downloaded file is empty, retrying..."
                rm -f "$DOWNLOAD_PATH"
            fi
        fi
        
        if [[ $attempt -eq 3 ]]; then
            error_exit "Failed to download MongoDB after 3 attempts"
        fi
        sleep 2
    done

    log "[4/7] Extracting and installing MongoDB Server"
    # Remove old installation if exists
    rm -rf "$MONGO_INSTALL_DIR"
    mkdir -p "$MONGO_INSTALL_DIR"

    # Extract MongoDB with better error handling
    log "Extracting MongoDB..."
    if ! tar -xzf "$DOWNLOAD_PATH" -C "$MONGO_INSTALL_DIR" --strip-components=1; then
        log "Standard extraction failed, trying alternative method..."
        # Try alternative extraction method
        cd /tmp
        rm -rf "mongodb-linux-aarch64-${DIST_SUFFIX}-${MONGO_VERSION}"
        if tar -xzf "$DOWNLOAD_PATH"; then
            mv "mongodb-linux-aarch64-${DIST_SUFFIX}-${MONGO_VERSION}"/* "$MONGO_INSTALL_DIR"/
            rm -rf "mongodb-linux-aarch64-${DIST_SUFFIX}-${MONGO_VERSION}"
        else
            error_exit "Failed to extract MongoDB tarball with both methods"
        fi
    fi

    # Verify extraction - check for mongod (server)
    if [[ ! -f "$MONGO_INSTALL_DIR/bin/mongod" ]]; then
        error_exit "MongoDB server binaries not found after extraction"
    fi

    # Check if mongosh exists, if not, provide warning but continue
    if [[ ! -f "$MONGO_INSTALL_DIR/bin/mongosh" ]]; then
        log "WARNING: MongoDB Shell (mongosh) not found in package"
        log "You may need to install it manually for replica set management"
    fi

    # Create symlink
    rm -f /opt/mongodb-current
    ln -sfn "$MONGO_INSTALL_DIR" /opt/mongodb-current

    # Create mongodb user if doesn't exist
    if ! id "mongodb" &>/dev/null; then
        useradd -r -s /bin/false -d /var/lib/mongodb -U mongodb
    fi
fi

log "[5/7] Creating data dirs"
USED_PORTS=()
for port in $(seq $PORT_RANGE_START $PORT_RANGE_END); do
        [[ ${#USED_PORTS[@]} -ge $MAX_INSTANCES ]] && break
        # Use socket check to determine port availability (more robust than process cmdline pattern)
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
        # Clean up socket files
        rm -f /tmp/mongodb-*.sock
fi

chown -R mongodb:mongodb "$DATA_BASE_DIR"270* 2>/dev/null || true

log "[6/7] Starting instances"
mkdir -p "$LOG_DIR"; chown -R mongodb:mongodb "$LOG_DIR"

# Clean up any existing socket files and fix permissions
log "Cleaning up socket files..."
rm -f /tmp/mongodb-*.sock

# Test MongoDB binary first
log "Testing MongoDB binary..."
if ! /opt/mongodb-current/bin/mongod --version; then
    error_exit "MongoDB binary test failed"
fi

# Check if instances are already running, skip startup if so
instances_running=0
for port in "${USED_PORTS[@]}"; do
    if ss -tuln | grep -q ":$port "; then
        log "Instance already running on port $port"
        ((instances_running++))
    fi
done

if [[ $instances_running -eq $MAX_INSTANCES ]]; then
    log "All MongoDB instances are already running, skipping startup"
else
    for port in "${USED_PORTS[@]}"; do
        # If port is already in use, skip startup
        if ss -tuln | grep -q ":$port "; then
            log "Port $port already in use, skipping startup"
            continue
        fi
        
        log "Starting port $port"
        
        # Clean up socket file for this port
        rm -f "/tmp/mongodb-${port}.sock"
        
        # Start MongoDB with Unix socket disabled to avoid permission issues
        log "Starting MongoDB on port $port..."
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
            # Verify via socket presence instead of cmdline substring
            if ss -tuln | grep -q ":$port "; then
                log "Instance $port started successfully"
            else
                log "WARNING: Port $port not listening, checking log..."
                if [[ -f "$LOG_DIR/mongod-$port.log" ]]; then
                    tail -20 "$LOG_DIR/mongod-$port.log" || true
                fi
                error_exit "Instance $port failed to start (port not listening)"
            fi
        else
            log "ERROR: mongod launch command failed for $port"
            if [[ -f "$LOG_DIR/mongod-$port.log" ]]; then
                log "=== LOG OUTPUT ==="
                tail -30 "$LOG_DIR/mongod-$port.log" || true
                log "=== END LOG ==="
            fi
            error_exit "Failed to start MongoDB on port $port"
        fi
    done
fi

log "[7/7] Replica set initialization"

# Check if mongosh is available
if [[ -f "/opt/mongodb-current/bin/mongosh" ]]; then
    MONGO_BIN="/opt/mongodb-current/bin/mongosh"
    log "Using MongoDB Shell for replica set configuration"
    
    sleep 8

    REPLICA_CONFIG="{ _id: \"${REPLICA_SET_NAME}\", members: [ { _id: 0, host: \"${RS_HOST}:${USED_PORTS[0]}\" }, { _id: 1, host: \"${RS_HOST}:${USED_PORTS[1]}\" }, { _id: 2, host: \"${RS_HOST}:${USED_PORTS[2]}\" } ] }"

    # Check if replica set is already initialized
    existing_status=$($MONGO_BIN --port "${USED_PORTS[0]}" --quiet --eval 'try { s=rs.status(); s.ok } catch(e){ 0 }' 2>/dev/null || echo 0)

    if [[ "$existing_status" == "1" ]]; then
        log "Replica set already initialized"
    else
        log "Running rs.initiate()"
        if $MONGO_BIN --port "${USED_PORTS[0]}" --eval "rs.initiate($REPLICA_CONFIG)" >/dev/null 2>&1; then
            log "Replica set initialization command sent"
        else
            log "WARNING: Replica set initialization may have failed"
        fi
    fi

    # Wait a bit for replica set to stabilize
    sleep 10

    log "[8/7] Wait for PRIMARY"
    primary_ok=0
    primary_port=""
    for i in {1..60}; do
        for port in "${USED_PORTS[@]}"; do
            state=$(mongo_my_state "$port")
            if [[ "$state" == "1" ]]; then
                primary_ok=1
                primary_port="$port"
                log "PRIMARY ready on port $port (attempt $i)"
                break 2
            fi
        done
        log "Waiting for PRIMARY... (attempt $i)"
        sleep 2
    done

    if [[ $primary_ok -eq 1 ]]; then
        log "Replica set is healthy with PRIMARY node on port $primary_port"
        
        # Verify replica set status
        if $MONGO_BIN --port "$primary_port" --quiet --eval 'rs.status().ok' 2>/dev/null | grep -q 1; then
            log "Replica set status: HEALTHY"
        else
            log "WARNING: Replica set status check failed"
        fi
    else
        log "WARNING: PRIMARY not ready after wait, but instances are running"
        log "You may need to manually initialize the replica set:"
        log "$MONGO_BIN --port ${USED_PORTS[0]} --eval \"rs.initiate($REPLICA_CONFIG)\""
    fi
else
    log "WARNING: MongoDB Shell not available, skipping replica set initialization"
    log "MongoDB instances are running but replica set is not configured"
    log "You can manually initialize the replica set using:"
    log "mongosh --port ${USED_PORTS[0]} --eval \"rs.initiate({ _id: \\\"rs\\\", members: [ { _id: 0, host: \\\"${RS_HOST}:${USED_PORTS[0]}\\\" }, { _id: 1, host: \\\"${RS_HOST}:${USED_PORTS[1]}\\\" }, { _id: 2, host: \\\"${RS_HOST}:${USED_PORTS[2]}\\\" } ] })\""
fi

log "---"
log "MongoDB ${MONGO_VERSION} deployment completed"
log "Ports: ${USED_PORTS[*]}"
log "Replica Set: $REPLICA_SET_NAME"
log "Logs: $LOG_DIR/mongod-*.log"
if [[ -f "/opt/mongodb-current/bin/mongosh" ]]; then
    log "Connect: mongosh --port ${USED_PORTS[0]}"
fi
log "Use: bash $0 STATUS=1 | STOP=1 | CLEAN=1"
exit 0